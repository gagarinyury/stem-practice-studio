#!/usr/bin/env python
"""Run basic-pitch with three configs side-by-side for A/B listening:
  A. Vocal stem, default thresholds
  B. Vocal stem, tighter thresholds + melodia trick + 150ms min note
  C. Full mix (source.wav), tighter thresholds

  python bench/pitch/compare.py /work/runs/<id> --from 30 --to 90
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

import run as bench_run  # type: ignore


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir", type=Path)
    ap.add_argument("--from", dest="from_sec", type=float, required=True)
    ap.add_argument("--to", dest="to_sec", type=float, required=True)
    args = ap.parse_args()

    out_dir = Path(__file__).parent / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    run_id = args.run_dir.name
    tag = f"{run_id}_{args.from_sec:.0f}-{args.to_sec:.0f}"

    vocal = args.run_dir / "stems" / "source_(Vocals)_htdemucs_6s.flac"
    full = args.run_dir / "source.wav"

    # (name, audio_path, runner_fn, kwargs)
    configs = [
        ("A_basic_pitch_default", vocal, bench_run.run_basic_pitch, dict()),
        ("B_basic_pitch_tight",   vocal, bench_run.run_basic_pitch, dict(
            onset_threshold=0.7, frame_threshold=0.5,
            minimum_note_length=150.0, melodia_trick=True)),
        ("C_basic_pitch_full",    full,  bench_run.run_basic_pitch, dict(
            onset_threshold=0.7, frame_threshold=0.5,
            minimum_note_length=150.0, melodia_trick=True)),
        ("D_swift_f0_default",    vocal, bench_run.run_swift_f0, dict()),
        ("E_swift_f0_strict",     vocal, bench_run.run_swift_f0, dict(
            confidence_threshold=0.93,
            split_semitone_threshold=1.0,
            min_note_duration=0.12,
            unvoiced_grace_period=0.05)),
        ("F_swift_f0_full",       full,  bench_run.run_swift_f0, dict()),
    ]

    summary = []
    for name, audio, runner, kwargs in configs:
        if not audio.exists():
            print(f"[{name}] skipped — {audio} not found", file=sys.stderr)
            continue
        out_path = out_dir / f"{tag}_{name}.json"
        try:
            notes = runner(audio, args.from_sec, args.to_sec, out_path, **kwargs)
            summary.append({"config": name, "notes": len(notes), "path": out_path.name})
        except Exception as e:
            print(f"[{name}] FAILED: {e}", file=sys.stderr)
            summary.append({"config": name, "error": str(e)})

    summary_path = out_dir / f"{tag}_compare_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2))
    print(f"\n[summary] {summary_path}", file=sys.stderr)
    for s in summary:
        print(f"  {s}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
