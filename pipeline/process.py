"""End-to-end pipeline: audio (file or YouTube URL) → stems + aligned lyrics.

Output structure:
    out_dir/
    ├── source.wav            (if --url; copied otherwise)
    ├── source.info.json      (yt-dlp metadata, if --url)
    ├── stems/
    │   ├── source_(Vocals)_htdemucs_6s.flac
    │   ├── source_(Drums)_htdemucs_6s.flac
    │   └── ... (Bass, Guitar, Piano, Other)
    ├── lyrics.json           (raw ASR — Parakeet for EN-like, GigaAM for RU)
    ├── lrc.txt               (LRCLib lines — only if a hit)
    ├── lrc_words.json        (tokenized + line-tagged words)
    ├── lyrics_aligned.json   (LRC text with timings from ASR — only if hit)
    └── manifest.json         (final glue file the player would consume)

Usable as a library (`from pipeline.process import run, RunOpts`) or as a
CLI (`python -m pipeline.process …`). Run on evo where docker images and
model weights live.
"""
import argparse
import json
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

# Local pipeline modules
from . import yt as yt_mod
from . import separate as sep_mod
from . import asr as asr_mod
from . import lrc as lrc_mod
from . import align as align_mod


REPO_ROOT = Path(__file__).resolve().parents[1]
ASR_CODE_DIR = REPO_ROOT / "bench" / "asr"

ProgressCb = Callable[[str, float], None]


@dataclass
class RunOpts:
    """Inputs for a single pipeline run.

    Exactly one of `input_path` or `url` must be set.
    """
    out_dir: Path
    input_path: Optional[Path] = None
    url: Optional[str] = None
    language: str = "en"
    artist: Optional[str] = None
    title: Optional[str] = None
    skip_separation: bool = False


# Stage → cumulative percentage emitted *after* the stage completes.
# Tuned so the slow `separate` stage (~60s out of ~100s) dominates the bar.
STAGE_PCT = {
    "resolve_input": 5.0,
    "separate": 70.0,
    "asr": 85.0,
    "lrclib": 90.0,
    "align": 95.0,
    "manifest": 100.0,
}


def _emit(cb: Optional[ProgressCb], stage: str) -> None:
    if cb:
        cb(stage, STAGE_PCT.get(stage, 0.0))


def _resolve_input(opts: RunOpts, out_dir: Path) -> tuple[Path, dict]:
    """Either download from URL or copy the local file. Returns (audio_path, metadata)."""
    if opts.url:
        print(f"[pipeline] yt-dlp ← {opts.url}", file=sys.stderr)
        audio, meta = yt_mod.download(opts.url, out_dir)
        return audio, meta

    if not opts.input_path:
        raise ValueError("RunOpts: either input_path or url must be set")
    src = Path(opts.input_path)
    if not src.exists():
        raise FileNotFoundError(f"input not found: {src}")
    dst = out_dir / f"source{src.suffix}"
    out_dir.mkdir(parents=True, exist_ok=True)
    # If caller already placed the file at the destination (e.g. backend
    # streamed an upload directly into out_dir), skip the redundant copy.
    if src.resolve() != dst.resolve():
        shutil.copy2(src, dst)
    meta = {
        "id": src.stem,
        "title": opts.title or src.stem,
        "uploader": None,
        "channel": None,
        "duration": None,
        "url": None,
    }
    return dst, meta


def run(opts: RunOpts, on_progress: Optional[ProgressCb] = None) -> dict:
    """Execute the full pipeline. Returns the manifest dict.

    `on_progress(stage, pct)` is called after each completed stage, where
    `stage` ∈ {resolve_input, separate, asr, lrclib, align, manifest} and
    `pct` is cumulative percentage of total work done.
    """
    out_dir = Path(opts.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    t_start = time.perf_counter()
    timings: dict[str, float] = {}

    # 1. Source
    t = time.perf_counter()
    audio_path, meta = _resolve_input(opts, out_dir)
    timings["resolve_input"] = round(time.perf_counter() - t, 2)
    print(f"[pipeline] source: {audio_path.name}  meta.title={meta.get('title')!r}",
          file=sys.stderr)
    _emit(on_progress, "resolve_input")

    # 2. Stems
    if opts.skip_separation and (out_dir / "stems").exists():
        print("[pipeline] skipping separation, reusing stems/", file=sys.stderr)
        stems = {}
        base = audio_path.stem
        for name in sep_mod.STEM_NAMES:
            p = out_dir / "stems" / f"{base}_({name})_htdemucs_6s.flac"
            if p.exists():
                stems[name.lower()] = p
    else:
        t = time.perf_counter()
        stems = sep_mod.separate(audio_path, out_dir)
        timings["separate"] = round(time.perf_counter() - t, 2)
    print(f"[pipeline] stems: {sorted(stems.keys())}", file=sys.stderr)
    _emit(on_progress, "separate")

    vocals = stems.get("vocals")
    if not vocals:
        raise RuntimeError("no vocals stem produced; aborting")

    # 3. ASR on vocals
    t = time.perf_counter()
    lyrics_path = out_dir / "lyrics.json"
    asr_mod.transcribe(vocals, lyrics_path, language=opts.language, code_dir=ASR_CODE_DIR)
    timings["asr"] = round(time.perf_counter() - t, 2)
    asr_data = json.loads(lyrics_path.read_text())
    print(f"[pipeline] asr: {len(asr_data.get('words', []))} words, "
          f"RTF={asr_data.get('rtf', 0):.3f}", file=sys.stderr)
    _emit(on_progress, "asr")

    # 4. LRCLib lookup
    artist = opts.artist or meta.get("uploader") or meta.get("channel") or ""
    title = opts.title or meta.get("title") or ""
    duration = meta.get("duration") or asr_data.get("duration")

    lrc_entry = None
    lrc_words: list[dict] = []
    if title:
        t = time.perf_counter()
        try:
            lrc_entry = lrc_mod.fetch(
                artist, title, duration,
                asr_words=asr_data.get("words") or None,
            )
        except Exception as e:
            print(f"[pipeline] lrclib error: {e}", file=sys.stderr)
        timings["lrclib"] = round(time.perf_counter() - t, 2)

    if lrc_entry:
        lrc_raw = lrc_entry.get("syncedLyrics") or lrc_entry.get("plainLyrics") or ""
        lines = lrc_mod.parse(lrc_raw)
        lrc_words = lrc_mod.words_from_lines(lines)
        (out_dir / "lrc.txt").write_text("\n".join(lines), encoding="utf-8")
        (out_dir / "lrc_words.json").write_text(
            json.dumps({
                "source": "lrclib",
                "artist": lrc_entry.get("artistName"),
                "title": lrc_entry.get("trackName"),
                "duration": lrc_entry.get("duration"),
                "synced": bool(lrc_entry.get("syncedLyrics")),
                "lines": lines,
                "words": lrc_words,
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"[pipeline] lrclib: hit {lrc_entry.get('artistName')!r} — "
              f"{lrc_entry.get('trackName')!r} ({len(lines)} lines, {len(lrc_words)} words)",
              file=sys.stderr)
    else:
        print(f"[pipeline] lrclib: no match for {artist!r} / {title!r}", file=sys.stderr)
    _emit(on_progress, "lrclib")

    # 5. Alignment
    aligned_path = None
    align_stats = None
    if lrc_words and asr_data.get("words"):
        t = time.perf_counter()
        aligned_words, align_stats = align_mod.align(
            asr_data["words"], lrc_words, asr_data.get("duration", 0.0))
        timings["align"] = round(time.perf_counter() - t, 2)
        aligned_path = out_dir / "lyrics_aligned.json"
        aligned_path.write_text(json.dumps({
            "model": "lrc-aligned-via-asr",
            "engine": "lrclib+" + asr_data.get("engine", "asr") + "+nw",
            "device": asr_data.get("device"),
            "audio": asr_data.get("audio"),
            "duration": asr_data.get("duration"),
            "lrc_source": {
                "artist": lrc_entry.get("artistName"),
                "title": lrc_entry.get("trackName"),
                "synced_in_lrclib": bool(lrc_entry.get("syncedLyrics")),
            },
            "alignment": align_stats,
            "lines": json.loads((out_dir / "lrc_words.json").read_text())["lines"],
            "text": " ".join(w["word"] for w in aligned_words),
            "words": aligned_words,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[pipeline] align: {align_stats['matched']}/{align_stats['lrc_words']} matched "
              f"({align_stats['match_rate']*100:.1f}%), "
              f"{align_stats['interpolated']} interpolated", file=sys.stderr)
    else:
        print("[pipeline] align: skipped (no LRC text)", file=sys.stderr)
    _emit(on_progress, "align")

    # 6. Manifest
    timings["total"] = round(time.perf_counter() - t_start, 2)
    manifest = {
        "id": meta.get("id"),
        "title": meta.get("title"),
        "artist": artist or None,
        "url": meta.get("url"),
        "duration": asr_data.get("duration"),
        "language": opts.language,
        "stems": {name: str(path.relative_to(out_dir)) for name, path in stems.items()},
        "lyrics": {
            "raw_asr": str(lyrics_path.relative_to(out_dir)),
            "engine": asr_data.get("engine") or asr_data.get("model"),
        },
        "lrc": {
            "found": bool(lrc_entry),
            "artist": lrc_entry.get("artistName") if lrc_entry else None,
            "title": lrc_entry.get("trackName") if lrc_entry else None,
        },
        "aligned": (
            {
                "path": str(aligned_path.relative_to(out_dir)),
                "match_rate": align_stats["match_rate"] if align_stats else None,
                "matched": align_stats["matched"] if align_stats else None,
                "lrc_words": align_stats["lrc_words"] if align_stats else None,
                "interpolated": align_stats["interpolated"] if align_stats else None,
            } if aligned_path else None
        ),
        "timings_sec": timings,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[pipeline] done in {timings['total']}s → {out_dir / 'manifest.json'}", file=sys.stderr)
    _emit(on_progress, "manifest")
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser(description="End-to-end stem-practice pipeline")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--input", help="path to local audio file (mp3/wav/flac/m4a)")
    src.add_argument("--url", help="YouTube URL — yt-dlp downloads bestaudio")

    ap.add_argument("-o", "--out", required=True, type=Path,
                    help="output directory (will be created)")
    ap.add_argument("--language", choices=["ru", "en", "fr", "de", "es", "it", "pt"],
                    default="en", help="ASR language; ru→GigaAM, others→Parakeet")
    ap.add_argument("--artist", help="override artist for LRCLib lookup")
    ap.add_argument("--title", help="override title for LRCLib lookup")
    ap.add_argument("--skip-separation", action="store_true",
                    help="reuse existing stems/ in --out (for debugging)")
    args = ap.parse_args()

    opts = RunOpts(
        out_dir=args.out,
        input_path=Path(args.input) if args.input else None,
        url=args.url,
        language=args.language,
        artist=args.artist,
        title=args.title,
        skip_separation=args.skip_separation,
    )

    def _print_progress(stage: str, pct: float) -> None:
        print(f"[pipeline] progress: {stage} ({pct:.0f}%)", file=sys.stderr)

    try:
        manifest = run(opts, on_progress=_print_progress)
    except (FileNotFoundError, ValueError, RuntimeError) as e:
        print(f"[pipeline] error: {e}", file=sys.stderr)
        return 1
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
