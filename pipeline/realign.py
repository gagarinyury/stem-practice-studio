"""Re-pick LRC + re-align on an existing run, keeping its ASR + stems intact.

Use when the LRC selection logic has improved (e.g. ASR-aware ranking)
and you want to backfill `lrc.txt`, `lrc_words.json`, `lyrics_aligned.json`,
and `manifest.json` without paying the cost of separation + ASR again.

  python -m pipeline.realign /work/runs/<id> --artist "..." --title "..."

Reads:
  <run>/lyrics.json          (existing ASR output)
  <run>/manifest.json        (for current artist/title/duration if not given)

Writes (overwrites):
  <run>/lrc.txt
  <run>/lrc_words.json
  <run>/lyrics_aligned.json
  <run>/manifest.json        (lrc + aligned fields refreshed; rest preserved)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import align as align_mod
from . import lrc as lrc_mod


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir", type=Path)
    ap.add_argument("--artist", default=None, help="override artist (defaults to manifest.artist)")
    ap.add_argument("--title", default=None, help="override title (defaults to manifest.lrc.title or manifest.title)")
    ap.add_argument("--identify", action="store_true",
                    help="run AcoustID on source audio first to backfill artist/title")
    args = ap.parse_args()

    run_dir = args.run_dir
    if not run_dir.is_dir():
        print(f"not a dir: {run_dir}", file=sys.stderr)
        return 1

    manifest_path = run_dir / "manifest.json"
    lyrics_path = run_dir / "lyrics.json"
    if not manifest_path.exists() or not lyrics_path.exists():
        print(f"missing manifest.json or lyrics.json in {run_dir}", file=sys.stderr)
        return 1

    manifest = json.loads(manifest_path.read_text())
    asr_data = json.loads(lyrics_path.read_text())

    # Optional AcoustID identify step — backfills artist/title for tracks
    # uploaded as files without tags or pulled from junk-named YT clips.
    if args.identify:
        # Try several known source audio locations.
        candidates = [run_dir / "source.wav", run_dir / "source.flac", run_dir / "source.mp3"]
        audio_path = next((p for p in candidates if p.exists()), None)
        if audio_path:
            try:
                from . import identify as identify_mod
                ident = identify_mod.identify(audio_path)
            except Exception as e:
                print(f"[realign] identify failed: {e}", file=sys.stderr)
                ident = None
            if ident:
                print(
                    f"[realign] acoustid: {ident.get('artist')!r} / {ident.get('title')!r} "
                    f"(score={ident.get('score')})",
                    file=sys.stderr,
                )
                if not args.artist and ident.get("artist"):
                    args.artist = ident["artist"]
                if not args.title and ident.get("title"):
                    args.title = ident["title"]
                # Stash full identify result on manifest for posterity.
                manifest["acoustid"] = ident
        else:
            print("[realign] no source audio found for fingerprint", file=sys.stderr)

    artist = args.artist or manifest.get("artist") or ""
    title = args.title or (manifest.get("lrc") or {}).get("title") or manifest.get("title") or ""
    duration = manifest.get("duration") or asr_data.get("duration") or 0.0
    asr_words = asr_data.get("words") or []

    print(f"[realign] {run_dir.name} · {artist!r} / {title!r} · {duration:.1f}s · {len(asr_words)} ASR words", file=sys.stderr)

    t = time.perf_counter()
    lrc_entry = None
    if title:
        lrc_entry = lrc_mod.fetch(
            artist, title, duration,
            asr_words=asr_words or None,
        )
    if not lrc_entry:
        if not asr_words:
            print(f"[realign] no LRC found and no ASR — nothing to do", file=sys.stderr)
            return 1
        print(f"[realign] no LRC found — falling back to ASR-only", file=sys.stderr)
        aligned_words, lines = align_mod.asr_to_aligned(asr_words)
        aligned_path = run_dir / "lyrics_aligned.json"
        aligned_path.write_text(json.dumps({
            "model": "asr-only",
            "engine": asr_data.get("engine", "asr"),
            "device": asr_data.get("device"),
            "audio": asr_data.get("audio"),
            "duration": asr_data.get("duration"),
            "lrc_source": None,
            "alignment": None,
            "lines": lines,
            "text": " ".join(w["word"] for w in aligned_words),
            "words": aligned_words,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        manifest["lrc"] = {"found": False, "artist": None, "title": None}
        manifest["aligned"] = {
            "path": str(aligned_path.relative_to(run_dir)),
            "match_rate": None, "matched": None,
            "lrc_words": None, "interpolated": None, "asr_only": True,
        }
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[realign] ASR-only: {len(aligned_words)} words, {len(lines)} lines → {manifest_path}", file=sys.stderr)
        return 0
    print(
        f"[realign] picked LRC id={lrc_entry.get('id')} "
        f"dur={lrc_entry.get('duration')}s synced={bool(lrc_entry.get('syncedLyrics'))} "
        f"({time.perf_counter() - t:.2f}s)",
        file=sys.stderr,
    )
    print(f"[realign] first LRC line: {(lrc_entry.get('plainLyrics') or '').splitlines()[0] if lrc_entry.get('plainLyrics') else '?'}", file=sys.stderr)

    lrc_raw = lrc_entry.get("syncedLyrics") or lrc_entry.get("plainLyrics") or ""
    lines = lrc_mod.parse(lrc_raw)
    lrc_words = lrc_mod.words_from_lines(lines)

    (run_dir / "lrc.txt").write_text("\n".join(lines), encoding="utf-8")
    (run_dir / "lrc_words.json").write_text(json.dumps({
        "source": "lrclib",
        "artist": lrc_entry.get("artistName"),
        "title": lrc_entry.get("trackName"),
        "duration": lrc_entry.get("duration"),
        "synced": bool(lrc_entry.get("syncedLyrics")),
        "lines": lines,
        "words": lrc_words,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    aligned, stats = align_mod.align(
        asr_data["words"], lrc_words, asr_data.get("duration", 0.0))
    aligned_path = run_dir / "lyrics_aligned.json"
    aligned_path.write_text(json.dumps({
        "engine": "lrclib+" + asr_data.get("engine", "asr") + "+nw",
        "device": asr_data.get("device"),
        "audio": asr_data.get("audio"),
        "duration": asr_data.get("duration"),
        "lines": lines,
        "words": aligned,
        "stats": stats,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"[realign] aligned: matched={stats['matched']}/{stats['lrc_words']} "
        f"({stats['match_rate']*100:.1f}%) interp={stats['interpolated']}",
        file=sys.stderr,
    )

    manifest["lrc"] = {
        "found": True,
        "artist": lrc_entry.get("artistName"),
        "title": lrc_entry.get("trackName"),
    }
    # Backfill top-level artist/title when the manifest had nothing or
    # only a junk filename. Caller-provided overrides win.
    if args.artist:
        manifest["artist"] = args.artist
    if args.title:
        manifest["title"] = args.title
    manifest["aligned"] = {
        "path": str(aligned_path.relative_to(run_dir)),
        "match_rate": stats["match_rate"],
        "matched": stats["matched"],
        "lrc_words": stats["lrc_words"],
        "interpolated": stats["interpolated"],
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[realign] done → {manifest_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
