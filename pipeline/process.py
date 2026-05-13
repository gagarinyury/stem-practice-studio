from __future__ import annotations

import concurrent.futures
import json
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from . import clients
from . import yt as yt_mod
from .identify import best_metadata_candidate, identify_candidates
from .lyrics import choose as choose_lyrics
from .state import RunState, atomic_write_json

ProgressCb = Callable[[dict], None]


@dataclass
class RunOpts:
    out_dir: Path
    input_path: Optional[Path] = None
    url: Optional[str] = None
    language: str = "ru"
    asr_engine: str = "parakeet"
    artist: Optional[str] = None
    title: Optional[str] = None


def _rel(run_dir: Path, path: Path | None) -> str | None:
    if path is None:
        return None
    return str(path.relative_to(run_dir))


def _emit(state: RunState, cb: ProgressCb | None, stage: str, **extra):
    event = state.event(stage, **extra)
    if cb:
        cb(event)


def resolve_input(opts: RunOpts, out_dir: Path) -> tuple[Path, dict]:
    if opts.url:
        audio, meta = yt_mod.download(opts.url, out_dir)
        return audio, meta
    if not opts.input_path:
        raise ValueError("input_path or url is required")
    src = opts.input_path.resolve()
    if not src.exists():
        raise FileNotFoundError(str(src))
    out_dir.mkdir(parents=True, exist_ok=True)
    dst = out_dir / f"source{src.suffix or '.wav'}"
    if src != dst.resolve():
        shutil.copy2(src, dst)
    return dst, {
        "id": out_dir.name,
        "title": opts.title,
        "artist": opts.artist,
        "uploader": None,
        "channel": None,
        "duration": None,
        "url": opts.url,
    }


def run(opts: RunOpts, on_progress: ProgressCb | None = None) -> dict:
    out_dir = opts.out_dir.resolve()
    track_id = out_dir.name
    state = RunState(out_dir, track_id)
    timings = state.timings
    t0 = time.perf_counter()

    _emit(state, on_progress, "queued")

    t = time.perf_counter()
    audio_path, meta = resolve_input(opts, out_dir)
    timings["resolve_input"] = round(time.perf_counter() - t, 2)

    source = {
        "audio": _rel(out_dir, audio_path),
        "stream": "source.opus" if (out_dir / "source.opus").exists() else _rel(out_dir, audio_path),
        "video": "video.mp4" if (out_dir / "video.mp4").exists() else None,
        "uploader": meta.get("uploader"),
        "channel": meta.get("channel"),
    }
    initial_identity = best_metadata_candidate(meta, opts.artist, opts.title)
    base_manifest = {
        "title": initial_identity.get("title") or opts.title or meta.get("title"),
        "artist": initial_identity.get("artist") or None,
        "url": meta.get("url"),
        "duration": meta.get("duration"),
        "language": opts.language,
        "source": source,
        "stems": {},
        "lyrics": None,
        "lrc": {"found": False},
        "aligned": None,
    }
    state.manifest(base_manifest)
    _emit(state, on_progress, "input_ready", source=source)

    shared: dict[str, object] = {"manifest": dict(base_manifest)}

    def lyrics_branch() -> None:
        lyrics_path = out_dir / "lyrics.json"
        t_asr = time.perf_counter()
        asr_data = clients.transcribe(audio_path, lyrics_path, language=opts.language, engine=opts.asr_engine)
        timings["asr"] = round(time.perf_counter() - t_asr, 2)
        _emit(state, on_progress, "asr_ready", words=len(asr_data.get("words") or []))

        t_ident = time.perf_counter()
        candidates = identify_candidates(asr_data.get("words") or [], meta, opts.artist, opts.title)
        timings["identify"] = round(time.perf_counter() - t_ident, 2)
        atomic_write_json(out_dir / "lyrics_candidates.json", {"candidates": candidates})
        _emit(state, on_progress, "identify_ready", candidates=len(candidates))

        duration = meta.get("duration") or asr_data.get("duration")
        t_lrc = time.perf_counter()
        picked = choose_lyrics(candidates, asr_data.get("words") or [], duration)
        timings["lyrics"] = round(time.perf_counter() - t_lrc, 2)
        atomic_write_json(out_dir / "lyrics_candidates.json", {"candidates": candidates, "lrclib": picked.candidates})

        reason = picked.stats.get("reason")
        partial = bool(picked.stats.get("partial"))
        lrc_meta = {"found": bool(picked.entry)}
        if reason:
            lrc_meta["reason"] = reason
        if partial:
            lrc_meta["partial"] = True
        if picked.entry:
            lrc_meta.update({
                "artist": picked.entry.get("artistName"),
                "title": picked.entry.get("trackName"),
                "duration": picked.entry.get("duration"),
                "synced": bool(picked.entry.get("syncedLyrics")),
            })
            (out_dir / "lrc.txt").write_text("\n".join(picked.lines), encoding="utf-8")
            atomic_write_json(out_dir / "lrc_words.json", {"source": "lrclib", **lrc_meta, "lines": picked.lines, "words": picked.words})

        aligned_path = out_dir / "lyrics_aligned.json"
        atomic_write_json(aligned_path, {
            "model": "lrc-partial-via-asr-raw" if partial else ("lrc-aligned-via-asr-raw" if picked.entry else "asr-only"),
            "engine": ("lrclib+" if picked.entry else "") + str(asr_data.get("engine") or opts.asr_engine),
            "duration": asr_data.get("duration"),
            "lrc_source": lrc_meta if picked.entry else None,
            "alignment": picked.stats if picked.entry else None,
            "reason": reason,
            "partial": partial,
            "lines": picked.lines,
            "text": " ".join(w.get("word", "") for w in picked.aligned_words),
            "words": picked.aligned_words,
        })

        manifest = dict(shared["manifest"])
        manifest.update({
            "title": (picked.entry or {}).get("trackName") or manifest.get("title"),
            "artist": (picked.entry or {}).get("artistName") or manifest.get("artist"),
            "duration": asr_data.get("duration") or manifest.get("duration"),
            "lyrics": {"raw_asr": "lyrics.json", "engine": asr_data.get("engine") or opts.asr_engine},
            "lrc": lrc_meta,
            "aligned": {
                "path": "lyrics_aligned.json",
                "match_rate": picked.stats.get("match_rate"),
                "matched": picked.stats.get("matched"),
                "lrc_words": picked.stats.get("lrc_words"),
                "interpolated": picked.stats.get("interpolated"),
                "asr_only": picked.stats.get("asr_only", False),
                "partial": partial,
                "reason": reason,
            },
        })
        shared["manifest"] = state.manifest(manifest)
        _emit(
            state,
            on_progress,
            "lyrics_ready",
            title=manifest.get("title"),
            artist=manifest.get("artist"),
            lrc=manifest.get("lrc"),
            aligned=manifest["aligned"],
        )

    def stems_branch() -> None:
        t_sep = time.perf_counter()
        stems = clients.separate(audio_path, out_dir)
        timings["separate"] = round(time.perf_counter() - t_sep, 2)
        manifest = dict(shared["manifest"])
        manifest["stems"] = {name: _rel(out_dir, path) for name, path in stems.items()}
        shared["manifest"] = state.manifest(manifest)
        _emit(
            state,
            on_progress,
            "stems_ready",
            title=manifest.get("title"),
            artist=manifest.get("artist"),
            stems=sorted(stems.keys()),
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        f_lyrics = pool.submit(lyrics_branch)
        f_stems = pool.submit(stems_branch)
        f_lyrics.result()
        f_stems.result()

    timings["total"] = round(time.perf_counter() - t0, 2)
    final_manifest = state.manifest(dict(shared["manifest"]))
    _emit(
        state,
        on_progress,
        "done",
        title=final_manifest.get("title"),
        artist=final_manifest.get("artist"),
        lrc=final_manifest.get("lrc"),
        aligned=final_manifest.get("aligned"),
        stems=sorted((final_manifest.get("stems") or {}).keys()),
    )
    return final_manifest


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--input")
    src.add_argument("--url")
    ap.add_argument("-o", "--out", required=True, type=Path)
    ap.add_argument("--language", default="ru")
    ap.add_argument("--asr-engine", default="parakeet", choices=["parakeet"])
    ap.add_argument("--artist")
    ap.add_argument("--title")
    args = ap.parse_args()
    manifest = run(RunOpts(
        out_dir=args.out,
        input_path=Path(args.input) if args.input else None,
        url=args.url,
        language=args.language,
        asr_engine=args.asr_engine,
        artist=args.artist,
        title=args.title,
    ), lambda e: print(json.dumps(e, ensure_ascii=False)))
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
