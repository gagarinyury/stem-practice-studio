"""Audio fingerprint identification via AcoustID + MusicBrainz.

Computes a chromaprint fingerprint of the source audio with `fpcalc`,
queries the free AcoustID API for matching MusicBrainz recordings, and
returns the best metadata hit (artist + title + album + MBID). Used in
`pipeline/process.py` to override junk metadata when a user uploads an
mp3 with no tags or a YouTube clip with channel-name junk in the title.

Requires:
  - `fpcalc` binary (`apt install libchromaprint-tools`) on the worker
  - `ACOUSTID_API_KEY` env var (free at https://acoustid.org/api-key)

If either is missing, `identify()` returns None and the pipeline
continues with whatever metadata the caller already had.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ACOUSTID_API_URL = "https://api.acoustid.org/v2/lookup"
# 120s of audio is plenty for a confident fingerprint and keeps the
# lookup payload small (chromaprint hashes get long quickly).
FPCALC_LENGTH = 120


def _fpcalc_available() -> bool:
    return shutil.which("fpcalc") is not None


def _fingerprint(audio_path: Path) -> tuple[str, int] | None:
    if not _fpcalc_available():
        print("[identify] fpcalc not on PATH — skipping", file=sys.stderr)
        return None
    try:
        proc = subprocess.run(
            ["fpcalc", "-json", "-length", str(FPCALC_LENGTH), str(audio_path)],
            capture_output=True, text=True, timeout=90, check=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"[identify] fpcalc failed: {e.stderr or e}", file=sys.stderr)
        return None
    except subprocess.TimeoutExpired:
        print("[identify] fpcalc timed out", file=sys.stderr)
        return None
    try:
        data = json.loads(proc.stdout)
        return data["fingerprint"], int(data["duration"])
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        print(f"[identify] fpcalc parse error: {e}", file=sys.stderr)
        return None


def _acoustid_lookup(fp: str, duration: int, api_key: str) -> list[dict]:
    params = {
        "client": api_key,
        "duration": str(duration),
        "fingerprint": fp,
        "meta": "recordings+releasegroups+compress",
    }
    body = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(
        ACOUSTID_API_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"[identify] AcoustID HTTP {e.code}: {e.read()[:200]!r}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"[identify] AcoustID request failed: {e}", file=sys.stderr)
        return []
    if data.get("status") != "ok":
        print(f"[identify] AcoustID error: {data.get('error')}", file=sys.stderr)
        return []
    return data.get("results", []) or []


def _pick_best(results: list[dict]) -> dict | None:
    """Pick the highest-scoring result that has at least one recording."""
    best = None
    best_score = 0.0
    for r in results:
        score = float(r.get("score") or 0)
        if not r.get("recordings"):
            continue
        if score > best_score:
            best, best_score = r, score
    return best


def identify(audio_path: Path) -> dict | None:
    """Identify a song by audio fingerprint.

    Returns `{artist, title, album, duration, mbid, score}` or None.
    """
    api_key = os.environ.get("ACOUSTID_API_KEY", "").strip()
    if not api_key:
        print("[identify] ACOUSTID_API_KEY not set — skipping", file=sys.stderr)
        return None

    fp_data = _fingerprint(audio_path)
    if not fp_data:
        return None
    fp, duration = fp_data

    results = _acoustid_lookup(fp, duration, api_key)
    if not results:
        print("[identify] AcoustID returned no matches", file=sys.stderr)
        return None

    best = _pick_best(results)
    if not best or best.get("score", 0) < 0.5:
        print(f"[identify] best score {best.get('score') if best else 'N/A'} too low", file=sys.stderr)
        return None

    rec = best["recordings"][0]
    artists = rec.get("artists", []) or []
    artist_name = ", ".join(a.get("name", "") for a in artists if a.get("name"))

    release_groups = rec.get("releasegroups", []) or []
    album_name = release_groups[0].get("title") if release_groups else None

    return {
        "title": rec.get("title"),
        "artist": artist_name or None,
        "album": album_name,
        "duration": rec.get("duration"),
        "mbid": rec.get("id"),
        "score": round(float(best.get("score", 0)), 3),
    }


def main() -> int:
    """CLI for ad-hoc identification: `python -m pipeline.identify <audio>`."""
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", type=Path)
    args = ap.parse_args()
    result = identify(args.audio)
    if result is None:
        print("no match", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
