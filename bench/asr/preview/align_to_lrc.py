"""Align ASR word timings (lyrics.json) to clean LRC text (lrc_words.json).

Method: Needleman-Wunsch alignment over word sequences with a normalized
Levenshtein distance as substitution cost. For each LRC word, copy timings
from its aligned ASR word. Unaligned LRC words (insertions) get their
timings interpolated linearly between the surrounding anchors.

Inputs (in `<folder>`):
    - lyrics.json     — ASR output {words: [{word, start, end}, ...]}
    - lrc_words.json  — LRCLib output {words: [{word, line}, ...]}

Output:
    - lyrics_aligned.json — same shape as lyrics.json, but `words` are the
      LRC tokens (clean text) with mapped timings, plus `lines` for grouping.
"""
import argparse
import json
import re
import sys
from pathlib import Path

WORD_NORM = re.compile(r"[^\w]+", re.UNICODE)


def norm(w: str) -> str:
    return WORD_NORM.sub("", w.lower()).replace("ё", "е")


def levenshtein(a: str, b: str) -> int:
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


def sub_cost(asr_w: str, lrc_w: str) -> float:
    a, b = norm(asr_w), norm(lrc_w)
    if not a or not b:
        return 1.0
    d = levenshtein(a, b)
    m = max(len(a), len(b))
    return d / m


# Penalty for skipping a word on either side. Tuned: skipping is cheaper than
# a near-miss substitution (avoid forcing matches across mangled regions),
# but more expensive than a clean match (don't skip when ASR is right).
SKIP_PENALTY = 0.55


def needleman_wunsch(asr_words: list[str], lrc_words: list[str]) -> list[tuple[int | None, int | None]]:
    """Return alignment as list of (asr_idx, lrc_idx) pairs; either side may be None."""
    n, m = len(asr_words), len(lrc_words)
    INF = float("inf")
    dp = [[INF] * (m + 1) for _ in range(n + 1)]
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
            sub = dp[i - 1][j - 1] + sub_cost(asr_words[i - 1], lrc_words[j - 1])
            ins = dp[i][j - 1] + SKIP_PENALTY  # LRC word with no ASR counterpart
            dele = dp[i - 1][j] + SKIP_PENALTY  # ASR word not in LRC
            best, op = min((sub, "match"), (ins, "ins"), (dele, "del"))
            dp[i][j] = best
            back[i][j] = op

    pairs: list[tuple[int | None, int | None]] = []
    i, j = n, m
    while i > 0 or j > 0:
        op = back[i][j]
        if op == "match":
            pairs.append((i - 1, j - 1))
            i -= 1
            j -= 1
        elif op == "ins":
            pairs.append((None, j - 1))
            j -= 1
        else:
            pairs.append((i - 1, None))
            i -= 1
    pairs.reverse()
    return pairs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    asr = json.loads((args.folder / "lyrics.json").read_text())
    lrc = json.loads((args.folder / "lrc_words.json").read_text())

    asr_words = asr["words"]
    lrc_words = lrc["words"]

    pairs = needleman_wunsch(
        [w["word"] for w in asr_words],
        [w["word"] for w in lrc_words],
    )

    # Map each LRC index -> ASR index when matched, else None.
    lrc_to_asr: list[int | None] = [None] * len(lrc_words)
    matched = 0
    for ai, li in pairs:
        if ai is not None and li is not None:
            lrc_to_asr[li] = ai
            matched += 1

    # Fill timings: matched LRC words copy from ASR; unmatched are interpolated.
    out_words: list[dict] = []
    n = len(lrc_words)
    for li in range(n):
        ai = lrc_to_asr[li]
        if ai is not None:
            w = asr_words[ai]
            out_words.append({
                "word": lrc_words[li]["word"],
                "line": lrc_words[li]["line"],
                "start": float(w["start"]),
                "end": float(w["end"]),
                "match": "asr",
                "asr_word": w["word"],
            })
        else:
            out_words.append({
                "word": lrc_words[li]["word"],
                "line": lrc_words[li]["line"],
                "start": None,
                "end": None,
                "match": "interp",
            })

    # Interpolate Nones using the nearest matched anchors on both sides.
    duration = float(asr.get("duration", 0.0))
    for li, w in enumerate(out_words):
        if w["start"] is not None:
            continue
        # Find previous anchor
        left = None
        for k in range(li - 1, -1, -1):
            if out_words[k]["start"] is not None:
                left = (k, out_words[k]["end"])
                break
        right = None
        for k in range(li + 1, n):
            if out_words[k]["start"] is not None:
                right = (k, out_words[k]["start"])
                break
        if left and right:
            lk, lt = left
            rk, rt = right
            span = rt - lt
            slot = (li - lk) / (rk - lk)
            t = lt + span * slot
            # Distribute equally among consecutive interp gaps
            gap_count = rk - lk
            slot_dur = span / gap_count
            w["start"] = round(t, 3)
            w["end"] = round(t + max(slot_dur * 0.9, 0.05), 3)
        elif left:
            lk, lt = left
            t = lt + 0.3 * (li - lk)
            w["start"] = round(t, 3)
            w["end"] = round(t + 0.3, 3)
        elif right:
            rk, rt = right
            t = max(rt - 0.3 * (rk - li), 0.0)
            w["start"] = round(t, 3)
            w["end"] = round(rt, 3)
        else:
            w["start"] = 0.0
            w["end"] = duration

    aligned = {
        "model": "lrc-aligned-via-asr",
        "engine": "lrclib+" + asr.get("engine", "asr") + "+nw",
        "device": asr.get("device"),
        "audio": asr.get("audio"),
        "duration": duration,
        "elapsed": asr.get("elapsed"),
        "rtf": asr.get("rtf"),
        "lrc_source": {
            "artist": lrc.get("artist"),
            "title": lrc.get("title"),
            "synced_in_lrclib": lrc.get("synced"),
        },
        "alignment": {
            "asr_words": len(asr_words),
            "lrc_words": len(lrc_words),
            "matched": matched,
            "match_rate": round(matched / max(len(lrc_words), 1), 3),
            "interpolated": sum(1 for w in out_words if w["match"] == "interp"),
        },
        "lines": lrc["lines"],
        "text": " ".join(w["word"] for w in out_words),
        "words": out_words,
    }

    out_path = args.out or (args.folder / "lyrics_aligned.json")
    out_path.write_text(json.dumps(aligned, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[align] {matched}/{len(lrc_words)} matched "
          f"({aligned['alignment']['match_rate']*100:.1f}%), "
          f"{aligned['alignment']['interpolated']} interpolated", file=sys.stderr)
    print(f"[align] wrote {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
