from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from . import align as align_mod
from . import lrc as lrc_mod


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


def lrclib_get(artist: str, title: str, duration: float | None) -> dict | None:
    if not artist or not title:
        return None
    qs = {"artist_name": artist, "track_name": title}
    if duration:
        qs["duration"] = str(int(round(duration)))
    try:
        return http_json("https://lrclib.net/api/get?" + urllib.parse.urlencode(qs))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
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
        try:
            res = http_json("https://lrclib.net/api/search?" + urllib.parse.urlencode(qs))
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


def choose(candidates: list[dict], asr_words: list[dict], duration: float | None) -> LyricsPick:
    seen_ids: set[int] = set()
    entries: list[tuple[dict, str]] = []
    debug: list[dict[str, Any]] = []

    for c in candidates:
        artist = c.get("artist") or ""
        title = c.get("title") or ""
        exact = lrclib_get(artist, title, duration)
        if exact and exact.get("id") not in seen_ids:
            seen_ids.add(exact.get("id"))
            entries.append((exact, f"exact:{c.get('source')}"))
        if exact:
            # Exact hit is still alignment-gated below. Avoid broad search unless needed.
            continue
        for hit in lrclib_search(artist, title)[:5]:
            if hit.get("id") in seen_ids:
                continue
            seen_ids.add(hit.get("id"))
            entries.append((hit, f"search:{c.get('source')}"))

    best = None
    best_tuple = (-1.0, -1.0, -1.0, 0.0)
    for entry, source in entries[:20]:
        lines, words, aligned, stats = score_entry(entry, asr_words, duration)
        item = {
            "source": source,
            "id": entry.get("id"),
            "artist": entry.get("artistName"),
            "title": entry.get("trackName"),
            "duration": entry.get("duration"),
            "synced": bool(entry.get("syncedLyrics")),
            "stats": stats,
        }
        debug.append(item)
        rank = (
            float(stats.get("combined_rate") or 0.0),
            float(stats.get("run_quality") or 0.0),
            float(stats.get("lrc_span") or 0.0),
            -abs((entry.get("duration") or 0.0) - duration) if duration else 0.0,
        )
        if rank > best_tuple:
            best_tuple = rank
            best = (entry, lines, words, aligned, stats)

    if best and accepted(best[4]):
        entry, lines, words, aligned, stats = best
        return LyricsPick(entry, lines, words, aligned, stats, debug)

    aligned, lines = align_mod.asr_to_aligned(asr_words)
    stats = {
        "asr_words": len(asr_words),
        "lrc_words": 0,
        "matched": 0,
        "match_rate": None,
        "interpolated": 0,
        "asr_only": True,
    }
    return LyricsPick(None, lines, [], aligned, stats, debug)
