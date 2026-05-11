"""Genius API search by ASR lyrics — fallback when AcoustID / LRCLib miss.

Sliding window of 3-5 consecutive ASR words → Genius search → aggregate top
hits by (artist, title) frequency. Honest test showed long messy queries
return 0 hits but short windows (3-5 words) reliably surface the right
song. Even 60% noise-windows are outvoted by the small fraction of clean
ones, because the correct (artist, title) accumulates across many windows.

Requires GENIUS_API_TOKEN env var (free, get one at
https://genius.com/api-clients). If missing, `identify_from_asr()` returns
None and the pipeline continues with whatever LRCLib produced (or ASR-only).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import re
from collections import Counter

GENIUS_SEARCH_URL = "https://api.genius.com/search"

# Genius decorates non-EN entries with a parenthesised translation/
# transliteration: "Время колокольчиков (Bells time)" / "Дмитрий Ревякин
# (Dmitry Revyakin)". LRCLib indexes by the native name only, so we
# strip these before retrying LRCLib.
_PAREN_TRAILER = re.compile(r"\s*\([^)]*\)\s*$")


def _strip_translation(s: str) -> str:
    out = _PAREN_TRAILER.sub("", s).strip()
    return out or s

# Common stop words across RU + EN — drop from sliding windows so signal
# concentrates on content words. Not exhaustive; just the most diluting.
_STOPWORDS = {
    "и", "в", "на", "не", "что", "это", "как", "по", "из", "за", "от",
    "до", "у", "о", "а", "но", "то", "так", "же", "бы", "ли", "ну", "вот",
    "если", "когда", "тут", "там", "уже", "ещё", "еще", "был", "была",
    "мы", "ты", "я", "он", "она", "они", "вы", "мне", "тебе", "нам",
    "the", "a", "an", "and", "or", "but", "of", "in", "on", "at", "to",
    "for", "with", "is", "are", "was", "were", "be", "been", "this",
    "that", "it", "i", "you", "we", "they", "he", "she",
}


def _search(query: str, token: str, per_query_timeout: float = 8.0) -> list[dict]:
    """Single Genius search. Returns list of hit results (may be empty)."""
    url = f"{GENIUS_SEARCH_URL}?{urllib.parse.urlencode({'q': query})}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=per_query_timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as e:
        print(f"[genius] query {query!r} failed: {e}", file=sys.stderr)
        return []
    return [h.get("result", {}) for h in data.get("response", {}).get("hits", [])]


def _clean_token(w: str) -> str:
    return "".join(c for c in w.lower() if c.isalnum() or c in "'-").strip("'-")


def _windows(words: list[str], size: int = 4, step: int = 3, max_windows: int = 30) -> list[str]:
    """Yield sliding-window phrases of `size` content words.

    Skips stopwords. Caps at `max_windows` queries to stay polite to
    Genius (their free tier is 1000/day but each track shouldn't burn
    more than ~30 calls).
    """
    content = [_clean_token(w) for w in words if _clean_token(w) and _clean_token(w) not in _STOPWORDS]
    out: list[str] = []
    for i in range(0, len(content) - size + 1, step):
        out.append(" ".join(content[i : i + size]))
        if len(out) >= max_windows:
            break
    return out


def identify_from_asr(asr_words: list[dict], language: str | None = None) -> dict | None:
    """Search Genius using ASR transcript. Returns `{artist, title, score, votes}` or None.

    `score` is how many windows had this (artist, title) in their top-3;
    `votes` is the same count for caller debugging.
    """
    token = os.environ.get("GENIUS_API_TOKEN", "").strip()
    if not token:
        print("[genius] GENIUS_API_TOKEN not set — skipping", file=sys.stderr)
        return None
    if not asr_words:
        return None

    words = [(w.get("word") or "").strip() for w in asr_words if (w.get("word") or "").strip()]
    if len(words) < 6:
        return None

    queries = _windows(words, size=4, step=3, max_windows=25)
    if not queries:
        return None

    counter: Counter[tuple[str, str]] = Counter()
    for q in queries:
        hits = _search(q, token)
        for h in hits[:3]:
            artist = (h.get("primary_artist") or {}).get("name") or ""
            title = h.get("title") or ""
            # Strip Genius's "(Translation)" or "(English Translation)" suffixes
            # that surface for non-EN songs — these are not the recording.
            if "translation" in title.lower():
                continue
            if artist and title:
                counter[(artist.strip(), title.strip())] += 1

    if not counter:
        return None

    (best_artist_raw, best_title_raw), votes = counter.most_common(1)[0]
    best_artist = _strip_translation(best_artist_raw)
    best_title = _strip_translation(best_title_raw)
    # Require at least 2 windows to vote for the same song — single-vote
    # candidates are statistical noise.
    if votes < 2:
        print(
            f"[genius] no candidate reached vote threshold (top={best_artist!r}/{best_title!r} votes={votes})",
            file=sys.stderr,
        )
        return None

    print(
        f"[genius] picked {best_artist!r} — {best_title!r} ({votes} votes across {len(queries)} windows)",
        file=sys.stderr,
    )
    return {"artist": best_artist, "title": best_title, "score": votes, "votes": votes}


def main() -> int:
    """CLI: `python -m pipeline.genius <lyrics.json>` — read ASR output, query Genius."""
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("lyrics_json", help="path to ASR lyrics.json")
    args = ap.parse_args()
    data = json.loads(open(args.lyrics_json, encoding="utf-8").read())
    res = identify_from_asr(data.get("words", []))
    if res is None:
        print("no match", file=sys.stderr)
        return 1
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
