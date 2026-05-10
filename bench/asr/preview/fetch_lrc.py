"""Fetch lyrics from LRCLib for a track and dump them next to lyrics.json.

Usage:
    python fetch_lrc.py <folder> --artist "X" --title "Y" [--duration 313]

Strategy:
  1. /api/get with artist+title (+optional duration filter for version disambiguation)
  2. Fall back to /api/search if /api/get returns 404 — pick best duration match
  3. Prefer entries with syncedLyrics; fall back to plainLyrics
  4. Strip [mm:ss.xx] markers, keep one line per song line
  5. Emit lrc.txt (plain) and lrc_words.json (flat word list with line indices)
"""
import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

UA = "stem-practice-studio/0.1 (https://github.com/gagarinyury/stem-practice-studio)"
LRC_TIMESTAMP = re.compile(r"\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]")
LRC_META = re.compile(r"\[(?:ti|ar|al|au|by|offset|re|ve|length):[^\]]*\]", re.IGNORECASE)


def http_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch(artist: str, title: str, duration: float | None) -> dict | None:
    # Exact get first
    params = {"artist_name": artist, "track_name": title}
    if duration is not None:
        params["duration"] = str(int(round(duration)))
    try:
        return http_json("https://lrclib.net/api/get?" + urllib.parse.urlencode(params))
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise

    # Search and pick best
    hits = http_json("https://lrclib.net/api/search?" +
                     urllib.parse.urlencode({"artist_name": artist, "track_name": title}))
    if not hits:
        return None

    def score(h: dict) -> tuple:
        synced = bool(h.get("syncedLyrics"))
        # Prefer hits with synced lyrics, then closer duration
        d = h.get("duration") or 0.0
        delta = abs(d - duration) if duration else 0.0
        return (-int(synced), delta)

    hits.sort(key=score)
    return hits[0]


def parse_lrc(lrc_text: str) -> list[str]:
    """Strip metadata + timestamps, return list of non-empty lines."""
    lines: list[str] = []
    for raw in lrc_text.splitlines():
        s = LRC_META.sub("", raw)
        s = LRC_TIMESTAMP.sub("", s).strip()
        if s:
            lines.append(s)
    return lines


def words_from_lines(lines: list[str]) -> list[dict]:
    out = []
    for line_idx, line in enumerate(lines):
        # Split on whitespace; keep punctuation attached so display matches LRC.
        for w in line.split():
            out.append({"word": w, "line": line_idx})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path)
    ap.add_argument("--artist", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--duration", type=float, default=None,
                    help="seconds — used to pick the right LRC version")
    args = ap.parse_args()

    if not args.folder.is_dir():
        print(f"folder not found: {args.folder}", file=sys.stderr)
        return 2

    print(f"[lrc] querying LRCLib: artist={args.artist!r} title={args.title!r}", file=sys.stderr)
    entry = fetch(args.artist, args.title, args.duration)
    if not entry:
        print("[lrc] no match found", file=sys.stderr)
        return 3

    print(f"[lrc] hit: {entry.get('artistName')} — {entry.get('trackName')} "
          f"(dur={entry.get('duration')}, synced={bool(entry.get('syncedLyrics'))})",
          file=sys.stderr)

    lrc_raw = entry.get("syncedLyrics") or entry.get("plainLyrics") or ""
    lines = parse_lrc(lrc_raw)
    words = words_from_lines(lines)
    print(f"[lrc] {len(lines)} lines, {len(words)} words", file=sys.stderr)

    (args.folder / "lrc.txt").write_text("\n".join(lines), encoding="utf-8")
    (args.folder / "lrc_words.json").write_text(
        json.dumps({
            "source": "lrclib",
            "artist": entry.get("artistName"),
            "title": entry.get("trackName"),
            "duration": entry.get("duration"),
            "synced": bool(entry.get("syncedLyrics")),
            "lines": lines,
            "words": words,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[lrc] wrote {args.folder/'lrc.txt'} and lrc_words.json", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
