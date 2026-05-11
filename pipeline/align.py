"""Needleman-Wunsch alignment between ASR words and LRC words.

Match cost = normalized Levenshtein on lowercased+stripped+ё→е tokens.
Skip penalty 0.55 — favour clean matches but allow drops where ASR is wrong.
"""
import re

WORD_NORM = re.compile(r"[^\w]+", re.UNICODE)
SKIP_PENALTY = 0.55


def _norm(w: str) -> str:
    return WORD_NORM.sub("", w.lower()).replace("ё", "е")


def _lev(a: str, b: str) -> int:
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur.append(min(cur[-1] + 1, prev[j] + 1, prev[j - 1] + cost))
        prev = cur
    return prev[-1]


def _sub_cost(asr_w: str, lrc_w: str) -> float:
    a, b = _norm(asr_w), _norm(lrc_w)
    if not a or not b:
        return 1.0
    return _lev(a, b) / max(len(a), len(b))


def _nw(asr_words: list[str], lrc_words: list[str]) -> list[tuple[int | None, int | None]]:
    n, m = len(asr_words), len(lrc_words)
    dp = [[float("inf")] * (m + 1) for _ in range(n + 1)]
    back = [[None] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0.0
    for i in range(1, n + 1):
        dp[i][0] = i * SKIP_PENALTY
        back[i][0] = "del"
    for j in range(1, m + 1):
        dp[0][j] = j * SKIP_PENALTY
        back[0][j] = "ins"
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            sub = dp[i - 1][j - 1] + _sub_cost(asr_words[i - 1], lrc_words[j - 1])
            ins = dp[i][j - 1] + SKIP_PENALTY
            dele = dp[i - 1][j] + SKIP_PENALTY
            best, op = min((sub, "match"), (ins, "ins"), (dele, "del"))
            dp[i][j] = best
            back[i][j] = op

    pairs = []
    i, j = n, m
    while i > 0 or j > 0:
        op = back[i][j]
        if op == "match":
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif op == "ins":
            pairs.append((None, j - 1)); j -= 1
        else:
            pairs.append((i - 1, None)); i -= 1
    pairs.reverse()
    return pairs


def align(asr_words: list[dict], lrc_words: list[dict], duration: float) -> tuple[list[dict], dict]:
    """Return (aligned_words, stats). Each aligned word gets start/end + match flag."""
    pairs = _nw([w["word"] for w in asr_words], [w["word"] for w in lrc_words])

    lrc_to_asr: list[int | None] = [None] * len(lrc_words)
    matched = 0
    for ai, li in pairs:
        if ai is not None and li is not None:
            lrc_to_asr[li] = ai
            matched += 1

    out = []
    n = len(lrc_words)
    for li in range(n):
        ai = lrc_to_asr[li]
        if ai is not None:
            w = asr_words[ai]
            out.append({
                "word": lrc_words[li]["word"],
                "line": lrc_words[li].get("line", 0),
                "start": float(w["start"]),
                "end": float(w["end"]),
                "match": "asr",
                "asr_word": w["word"],
            })
        else:
            out.append({
                "word": lrc_words[li]["word"],
                "line": lrc_words[li].get("line", 0),
                "start": None,
                "end": None,
                "match": "interp",
            })

    # Linear interpolation between matched anchors.
    for li, w in enumerate(out):
        if w["start"] is not None:
            continue
        left = next(((k, out[k]["end"]) for k in range(li - 1, -1, -1)
                     if out[k]["start"] is not None), None)
        right = next(((k, out[k]["start"]) for k in range(li + 1, n)
                      if out[k]["start"] is not None), None)
        if left and right:
            lk, lt = left
            rk, rt = right
            slot = (li - lk) / (rk - lk)
            t = lt + (rt - lt) * slot
            slot_dur = (rt - lt) / (rk - lk)
            w["start"] = round(t, 3)
            w["end"] = round(t + max(slot_dur * 0.9, 0.05), 3)
        elif left:
            lk, lt = left
            t = lt + 0.3 * (li - lk)
            w["start"] = round(t, 3); w["end"] = round(t + 0.3, 3)
        elif right:
            rk, rt = right
            t = max(rt - 0.3 * (rk - li), 0.0)
            w["start"] = round(t, 3); w["end"] = round(rt, 3)
        else:
            w["start"] = 0.0; w["end"] = duration

    interp = sum(1 for w in out if w["match"] == "interp")

    # Run-length quality: count consecutive (ai, li) → (ai+1, li+1) pairs.
    # A real song match has long runs (phrase-level alignment); a noise
    # match is a sparse scatter of single-token coincidences with gaps.
    matched_pairs = [(ai, li) for ai, li in pairs if ai is not None and li is not None]
    runs: list[int] = []
    if matched_pairs:
        cur = 1
        for k in range(1, len(matched_pairs)):
            prev_ai, prev_li = matched_pairs[k - 1]
            ai, li = matched_pairs[k]
            if ai == prev_ai + 1 and li == prev_li + 1:
                cur += 1
            else:
                runs.append(cur); cur = 1
        runs.append(cur)
    longest_run = max(runs) if runs else 0
    in_long_runs = sum(r for r in runs if r >= 3)
    run_quality = round(in_long_runs / max(matched, 1), 3)

    # Span coverage: a true match spreads matched LRC positions across
    # most of the LRC; a noise match clusters them in a narrow window.
    if matched_pairs:
        li_indices = [li for _, li in matched_pairs]
        span = (max(li_indices) - min(li_indices) + 1) / max(len(lrc_words), 1)
    else:
        span = 0.0

    stats = {
        "asr_words": len(asr_words),
        "lrc_words": len(lrc_words),
        "matched": matched,
        "match_rate": round(matched / max(len(lrc_words), 1), 3),
        "interpolated": interp,
        "longest_run": longest_run,
        "run_quality": run_quality,
        "lrc_span": round(span, 3),
    }
    return out, stats


# ─── Fallback: ASR-only aligned output ─────────────────────────────────────
# Emits the same shape `lyrics_aligned.json` but using the raw ASR words as
# the source of truth. Used when LRClib has nothing for the track — the
# frontend (drill, select) can still group words into lines and let the user
# loop on phrases, just with the ASR's spelling errors.

def asr_to_aligned(
    asr_words: list[dict],
    line_gap_sec: float = 1.0,
    max_words_per_line: int = 12,
) -> tuple[list[dict], list[str]]:
    """Group raw ASR words into "lines" by silence gaps.

    Returns (aligned_words, lines). Each word matches the schema used by
    LRC alignment: {word, line, start, end, match: "asr", asr_word}.
    """
    if not asr_words:
        return [], []
    aligned: list[dict] = []
    lines: list[str] = []
    cur_line: list[str] = []
    cur_idx = 0
    prev_end = float(asr_words[0]["start"])
    for w in asr_words:
        start = float(w["start"])
        end = float(w["end"])
        text = w["word"]
        gap = start - prev_end
        if cur_line and (gap > line_gap_sec or len(cur_line) >= max_words_per_line):
            lines.append(" ".join(cur_line))
            cur_idx += 1
            cur_line = []
        aligned.append({
            "word": text,
            "line": cur_idx,
            "start": start,
            "end": end,
            "match": "asr",
            "asr_word": text,
        })
        cur_line.append(text)
        prev_end = end
    if cur_line:
        lines.append(" ".join(cur_line))
    return aligned, lines
