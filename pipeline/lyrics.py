from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from . import align as align_mod
from . import lrc as lrc_mod
from . import runtime_cache


UA = "stem-practice-studio-clean/0.1"


def norm_word(value: str) -> str:
    return "".join(ch for ch in value.lower().replace("ё", "е") if ch.isalnum())


def lev(a: str, b: str) -> int:
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(cur[-1] + 1, prev[j] + 1, prev[j - 1] + (0 if ca == cb else 1)))
        prev = cur
    return prev[-1]


def similar(a: str, b: str) -> bool:
    na, nb = norm_word(a), norm_word(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    return lev(na, nb) / max(len(na), len(nb)) <= 0.34


def script_mismatch(asr_words: list[dict], lrc_text: str) -> bool:
    asr_text = " ".join(str(w.get("word", "")) for w in asr_words)
    asr_cyr, asr_lat = lrc_mod._script_profile(asr_text)
    lrc_cyr, lrc_lat = lrc_mod._script_profile(lrc_text)
    if max(asr_cyr, asr_lat) < 0.5 or max(lrc_cyr, lrc_lat) < 0.5:
        return False
    return (asr_cyr > asr_lat) != (lrc_cyr > lrc_lat)


def true_alignment_stats(aligned: list[dict], asr_words: list[dict], lrc_words: list[dict]) -> dict[str, Any]:
    matched_indices: list[int] = []
    for idx, item in enumerate(aligned):
        if similar(str(item.get("word", "")), str(item.get("asr_word", ""))):
            matched_indices.append(idx)
        elif item.get("match") == "asr":
            item["match"] = "interp"
            item.pop("asr_word", None)

    runs: list[int] = []
    if matched_indices:
        cur = 1
        for prev, cur_idx in zip(matched_indices, matched_indices[1:]):
            if cur_idx == prev + 1:
                cur += 1
            else:
                runs.append(cur)
                cur = 1
        runs.append(cur)

    matched = len(matched_indices)
    lrc_count = len(lrc_words)
    asr_count = len(asr_words)
    longest_run = max(runs) if runs else 0
    in_long_runs = sum(r for r in runs if r >= 3)
    span = ((max(matched_indices) - min(matched_indices) + 1) / max(lrc_count, 1)) if matched_indices else 0.0
    match_rate = matched / max(lrc_count, 1)
    asr_coverage = matched / max(asr_count, 1)
    return {
        "asr_words": asr_count,
        "lrc_words": lrc_count,
        "matched": matched,
        "match_rate": round(match_rate, 3),
        "asr_coverage": round(asr_coverage, 3),
        "combined_rate": round(min(match_rate, asr_coverage), 3),
        "interpolated": lrc_count - matched,
        "longest_run": longest_run,
        "run_quality": round(in_long_runs / max(matched, 1), 3),
        "lrc_span": round(span, 3),
    }


@dataclass
class LyricsPick:
    entry: dict[str, Any] | None
    lines: list[str]
    words: list[dict]
    aligned_words: list[dict]
    stats: dict[str, Any]
    candidates: list[dict[str, Any]]


def http_json(url: str, timeout: int = 10):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def lrclib_get(artist: str, title: str) -> dict | None:
    if not artist or not title:
        return None
    qs = {"artist_name": artist, "track_name": title}
    key = [artist, title]
    cached = runtime_cache.get("lrclib-get-v1", key)
    if cached is not None:
        return cached.get("data")
    try:
        data = http_json("https://lrclib.net/api/get?" + urllib.parse.urlencode(qs))
        runtime_cache.set("lrclib-get-v1", key, {"data": data})
        return data
    except urllib.error.HTTPError as e:
        if e.code == 404:
            runtime_cache.set("lrclib-get-v1", key, {"data": None})
            return None
        raise
    except Exception:
        return None


def lrclib_get_by_id(entry_id: int) -> dict | None:
    key = [entry_id]
    cached = runtime_cache.get("lrclib-get-id-v1", key)
    if cached is not None:
        return cached.get("data")
    try:
        data = http_json(f"https://lrclib.net/api/get/{int(entry_id)}", timeout=20)
        runtime_cache.set("lrclib-get-id-v1", key, {"data": data})
        return data
    except urllib.error.HTTPError as e:
        if e.code == 404:
            runtime_cache.set("lrclib-get-id-v1", key, {"data": None})
            return None
        return None
    except Exception:
        return None


def lrclib_search(artist: str, title: str) -> list[dict]:
    out: list[dict] = []
    seen: set[int] = set()
    queries = []
    if artist and title:
        queries.append({"artist_name": artist, "track_name": title})
    if title:
        queries.append({"track_name": title})
    for qs in queries:
        key = [qs.get("artist_name"), qs.get("track_name")]
        try:
            cached = runtime_cache.get("lrclib-search-v1", key)
            if cached is None:
                res = http_json("https://lrclib.net/api/search?" + urllib.parse.urlencode(qs))
                runtime_cache.set("lrclib-search-v1", key, {"data": res or []})
            else:
                res = cached.get("data") or []
        except Exception:
            continue
        for h in res or []:
            hid = h.get("id")
            if hid is None or hid in seen:
                continue
            seen.add(hid)
            out.append(h)
    return out


def score_entry(entry: dict, asr_words: list[dict], duration: float | None) -> tuple[list[str], list[dict], list[dict], dict]:
    raw = entry.get("syncedLyrics") or entry.get("plainLyrics") or ""
    lines = lrc_mod.parse(raw)
    words = lrc_mod.words_from_lines(lines)
    if script_mismatch(asr_words, raw):
        return lines, words, [], {
            "asr_words": len(asr_words),
            "lrc_words": len(words),
            "matched": 0,
            "match_rate": 0.0,
            "asr_coverage": 0.0,
            "combined_rate": 0.0,
            "interpolated": len(words),
            "longest_run": 0,
            "run_quality": 0.0,
            "lrc_span": 0.0,
            "rejected": "script_mismatch",
        }
    if not words or not asr_words:
        return lines, words, [], {}
    aligned, stats = align_mod.align(asr_words, words, duration or 0.0)
    stats = true_alignment_stats(aligned, asr_words, words)
    return lines, words, aligned, stats


def accepted(stats: dict[str, Any]) -> bool:
    return (
        (stats.get("combined_rate") or 0.0) >= 0.55
        and (stats.get("run_quality") or 0.0) >= 0.40
        and (stats.get("lrc_span") or 0.0) >= 0.50
    )


def partial_accepted(stats: dict[str, Any]) -> bool:
    return (
        not stats.get("rejected")
        and (stats.get("asr_coverage") or 0.0) >= 0.65
        and (stats.get("run_quality") or 0.0) >= 0.60
        and (stats.get("matched") or 0) >= 30
    )


def matched_indices(aligned: list[dict]) -> list[int]:
    out: list[int] = []
    for idx, item in enumerate(aligned):
        if similar(str(item.get("word", "")), str(item.get("asr_word", ""))):
            out.append(idx)
    return out


def crop_partial(
    lines: list[str],
    words: list[dict],
    aligned: list[dict],
    stats: dict[str, Any],
) -> tuple[list[str], list[dict], list[dict], dict[str, Any]]:
    indices = matched_indices(aligned)
    if not indices:
        return lines, words, aligned, stats
    start, end = min(indices), max(indices)
    cropped_words = [dict(w) for w in words[start:end + 1]]
    cropped_aligned = [dict(w) for w in aligned[start:end + 1]]

    line_map: dict[int, int] = {}
    next_line = 0
    for item in cropped_words:
        old_line = int(item.get("line", 0))
        if old_line not in line_map:
            line_map[old_line] = next_line
            next_line += 1
        item["line"] = line_map[old_line]
    for item in cropped_aligned:
        old_line = int(item.get("line", 0))
        item["line"] = line_map.setdefault(old_line, len(line_map))

    partial_lines: list[str] = []
    for line_idx in range(len(line_map)):
        partial_lines.append(" ".join(str(w.get("word", "")) for w in cropped_words if w.get("line") == line_idx).strip())
    partial_lines = [line for line in partial_lines if line]

    matched = len(matched_indices(cropped_aligned))
    lrc_count = len(cropped_words)
    asr_count = int(stats.get("asr_words") or 0)
    partial_stats = {
        **stats,
        "lrc_words": lrc_count,
        "matched": matched,
        "match_rate": round(matched / max(lrc_count, 1), 3),
        "asr_coverage": round(matched / max(asr_count, 1), 3) if asr_count else stats.get("asr_coverage"),
        "combined_rate": round(min(matched / max(lrc_count, 1), matched / max(asr_count, 1)), 3) if asr_count else stats.get("combined_rate"),
        "interpolated": sum(1 for w in cropped_aligned if w.get("match") == "interp"),
        "lrc_span": 1.0,
        "partial": True,
        "reason": "partial_cover_available",
        "full_lrc_words": stats.get("lrc_words"),
    }
    return partial_lines, cropped_words, cropped_aligned, partial_stats


def rejection_reason(debug: list[dict[str, Any]]) -> str:
    if not debug:
        return "lrclib_not_found"
    stats_list = [d.get("stats") or {} for d in debug]
    if any(s.get("rejected") == "script_mismatch" for s in stats_list):
        return "script_mismatch"
    best = max(
        stats_list,
        key=lambda s: (
            float(s.get("combined_rate") or 0.0),
            float(s.get("run_quality") or 0.0),
            float(s.get("lrc_span") or 0.0),
        ),
    )
    if (best.get("asr_coverage") or 0.0) < 0.45 or (best.get("run_quality") or 0.0) < 0.40:
        return "unsupported_or_weak_asr_language"
    return "lrclib_rejected_low_match"


def public_candidates(debug: list[dict[str, Any]], *, limit: int = 5) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in debug[:limit]:
        stats = item.get("stats") or {}
        out.append({
            "id": item.get("id"),
            "artist": item.get("artist"),
            "title": item.get("title"),
            "duration": item.get("duration"),
            "synced": bool(item.get("synced")),
            "source": item.get("source"),
            "stats": {
                "match_rate": stats.get("match_rate"),
                "asr_coverage": stats.get("asr_coverage"),
                "combined_rate": stats.get("combined_rate"),
                "run_quality": stats.get("run_quality"),
                "lrc_span": stats.get("lrc_span"),
                "matched": stats.get("matched"),
                "lrc_words": stats.get("lrc_words"),
            },
        })
    return [c for c in out if c.get("id") and c.get("artist") and c.get("title")]


def fetch_candidate_entry(candidate: dict[str, Any]) -> dict | None:
    entry_id = candidate.get("id")
    artist = str(candidate.get("artist") or "")
    title = str(candidate.get("title") or "")
    exact = lrclib_get(artist, title)
    if exact and (entry_id is None or exact.get("id") == entry_id):
        return exact
    for hit in lrclib_search(artist, title):
        if entry_id is None or hit.get("id") == entry_id:
            return hit
    if entry_id is not None:
        by_id = lrclib_get_by_id(int(entry_id))
        if by_id:
            return by_id
    return exact


def confirmed_pick(entry: dict, asr_words: list[dict], duration: float | None) -> LyricsPick:
    lines, words, aligned, stats = score_entry(entry, asr_words, duration)
    if stats.get("rejected") == "script_mismatch":
        raise ValueError("candidate script does not match ASR transcript")
    if not words or not aligned:
        raise ValueError("candidate has no usable lyrics")
    stats = {
        **stats,
        "reason": "user_confirmed_lrc",
        "user_confirmed": True,
    }
    return LyricsPick(entry, lines, words, aligned, stats, [])


def choose(candidates: list[dict], asr_words: list[dict], duration: float | None) -> LyricsPick:
    seen_ids: set[int] = set()
    debug: list[dict[str, Any]] = []
    best = None
    best_tuple = (-1.0, -1.0, -1.0, 0.0)

    def consider(entry: dict, source: str) -> LyricsPick | None:
        nonlocal best, best_tuple
        entry_id = entry.get("id")
        if entry_id in seen_ids:
            return None
        seen_ids.add(entry_id)
        lines, words, aligned, stats = score_entry(entry, asr_words, duration)
        debug.append({
            "source": source,
            "id": entry_id,
            "artist": entry.get("artistName"),
            "title": entry.get("trackName"),
            "duration": entry.get("duration"),
            "synced": bool(entry.get("syncedLyrics")),
            "stats": stats,
        })
        if accepted(stats):
            return LyricsPick(entry, lines, words, aligned, stats, debug)
        if partial_accepted(stats):
            partial_lines, partial_words, partial_aligned, partial_stats = crop_partial(lines, words, aligned, stats)
            return LyricsPick(entry, partial_lines, partial_words, partial_aligned, partial_stats, debug)
        rank = (
            float(stats.get("combined_rate") or 0.0),
            float(stats.get("run_quality") or 0.0),
            float(stats.get("lrc_span") or 0.0),
            -abs((entry.get("duration") or 0.0) - duration) if duration else 0.0,
        )
        if rank > best_tuple:
            best_tuple = rank
            best = (entry, lines, words, aligned, stats)
        return None

    for c in candidates:
        artist = c.get("artist") or ""
        title = c.get("title") or ""
        source = c.get("source") or "candidate"
        score = float(c.get("score") or 0.0)
        if not title:
            continue

        had_lrclib_hit = False
        exact = lrclib_get(artist, title)
        if exact:
            had_lrclib_hit = True
            pick = consider(exact, f"exact:{source}")
            if pick:
                return pick
            # Exact hit was already alignment-gated. A broad search for the
            # same candidate usually just adds duplicate versions, so move on.
            if source in {"metadata-split", "metadata-title-part"} and score >= 80:
                break
            continue

        # Broad search is the expensive part. Keep it only for candidates that
        # we ranked as plausible, and stop as soon as a candidate passes ASR
        # alignment. Low-score fallbacks get one chance at most.
        search_limit = 3 if score >= 60 or source.startswith("metadata") else 1
        for hit in lrclib_search(artist, title)[:search_limit]:
            had_lrclib_hit = True
            pick = consider(hit, f"search:{source}")
            if pick:
                return pick

        # If a high-confidence metadata candidate found LRCLib lyrics but ASR
        # rejected them, trying unrelated ASR-search guesses usually creates
        # the long 40-150s tail. Fall back to ASR-only instead.
        if had_lrclib_hit and source in {"metadata-split", "metadata-title-part"} and score >= 80:
            break

    aligned, lines = align_mod.asr_to_aligned(asr_words)
    stats = {
        "asr_words": len(asr_words),
        "lrc_words": 0,
        "matched": 0,
        "match_rate": None,
        "interpolated": 0,
        "asr_only": True,
        "reason": rejection_reason(debug),
    }
    return LyricsPick(None, lines, [], aligned, stats, debug)
