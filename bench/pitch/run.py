#!/usr/bin/env python
"""Compare three pitch-detection approaches on a vocal stem slice.

Outputs:
  out/<run_id>_<from>-<to>_basic_pitch.json   — Spotify basic-pitch notes
  out/<run_id>_<from>-<to>_librosa.json       — librosa.pyin F0 curve
  out/<run_id>_<from>-<to>_meta.json          — slice metadata

Run inside a container with basic-pitch + librosa installed:

  docker run --rm -v /srv/apps/stem-practice-studio:/work \\
    stem-pitch-bench python /work/bench/pitch/run.py \\
    /work/runs/kalinov-most "stems/source_(Vocals)_htdemucs_6s.flac" \\
    --from 32 --to 37
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def slice_audio(audio_path: Path, from_sec: float, to_sec: float):
    import soundfile as sf
    import numpy as np

    info = sf.info(str(audio_path))
    sr = info.samplerate
    start = int(from_sec * sr)
    stop = int(to_sec * sr)
    data, sr2 = sf.read(str(audio_path), start=start, stop=stop, always_2d=False)
    assert sr2 == sr
    if data.ndim == 2:  # stereo → mono
        data = data.mean(axis=1)
    return data.astype(np.float32), sr


def run_basic_pitch(
    audio_path: Path,
    from_sec: float,
    to_sec: float,
    out_path: Path,
    onset_threshold: float = 0.5,
    frame_threshold: float = 0.3,
    minimum_note_length: float = 127.7,  # ms — basic-pitch default
    melodia_trick: bool = True,
):
    """Spotify basic-pitch — neural model that outputs MIDI notes."""
    import tempfile
    import soundfile as sf
    from basic_pitch.inference import predict
    from basic_pitch import ICASSP_2022_MODEL_PATH

    audio, sr = slice_audio(audio_path, from_sec, to_sec)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        sf.write(tmp.name, audio, sr)
        tmp_path = tmp.name

    print(
        f"[basic-pitch] {audio_path.name} {from_sec}–{to_sec}s "
        f"onset={onset_threshold} frame={frame_threshold} "
        f"melodia={melodia_trick} min_note={minimum_note_length}ms",
        file=sys.stderr,
    )
    _, _, note_events = predict(
        tmp_path,
        model_or_model_path=ICASSP_2022_MODEL_PATH,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
        minimum_note_length=minimum_note_length,
        melodia_trick=melodia_trick,
    )
    notes = [
        {
            "midi": int(n[2]),
            "fromSec": round(float(n[0]) + from_sec, 4),
            "toSec": round(float(n[1]) + from_sec, 4),
            "amplitude": round(float(n[3]), 3),
        }
        for n in note_events
    ]
    out_path.write_text(json.dumps({"notes": notes, "params": {
        "onset_threshold": onset_threshold,
        "frame_threshold": frame_threshold,
        "minimum_note_length": minimum_note_length,
        "melodia_trick": melodia_trick,
        "source": str(audio_path.name),
    }}, indent=2))
    print(f"[basic-pitch] {len(notes)} notes → {out_path.name}", file=sys.stderr)
    return notes


def run_swift_f0(
    audio_path: Path,
    from_sec: float,
    to_sec: float,
    out_path: Path,
    confidence_threshold: float = 0.9,
    split_semitone_threshold: float = 0.8,
    min_note_duration: float = 0.08,
    unvoiced_grace_period: float = 0.02,
):
    """SwiftF0 — neural F0 detector with built-in note segmentation.
    Tiny CNN (95K params), trained for monophonic. Faster + more accurate
    than CREPE per the Aug-2025 paper.
    """
    import librosa
    import numpy as np
    from swift_f0 import SwiftF0, segment_notes

    audio, sr = slice_audio(audio_path, from_sec, to_sec)
    # SwiftF0 expects 16kHz mono.
    if sr != 16000:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
        sr = 16000

    print(
        f"[swift-f0] {audio_path.name} {from_sec}–{to_sec}s "
        f"conf={confidence_threshold} split={split_semitone_threshold} "
        f"min_note={min_note_duration}s grace={unvoiced_grace_period}s",
        file=sys.stderr,
    )
    detector = SwiftF0(
        fmin=46.875,
        fmax=2093.75,
        confidence_threshold=confidence_threshold,
    )
    result = detector.detect_from_array(audio_array=audio, sample_rate=sr)
    notes_segs = segment_notes(
        result,
        split_semitone_threshold=split_semitone_threshold,
        min_note_duration=min_note_duration,
        unvoiced_grace_period=unvoiced_grace_period,
    )

    # Inspect first segment to learn the dataclass field names.
    notes = []
    for seg in notes_segs:
        # Try common field names
        midi = getattr(seg, "pitch_midi", None) or getattr(seg, "midi", None)
        start = getattr(seg, "start_time", None)
        if start is None:
            start = getattr(seg, "start", None)
        end = getattr(seg, "end_time", None)
        if end is None:
            end = getattr(seg, "end", None)
        if midi is None or start is None or end is None:
            print(f"[swift-f0] WARN unknown seg fields: {seg}", file=sys.stderr)
            continue
        notes.append({
            "midi": int(midi),
            "fromSec": round(float(start) + from_sec, 4),
            "toSec": round(float(end) + from_sec, 4),
            "amplitude": 0.6,
        })

    out_path.write_text(json.dumps({
        "notes": notes,
        "params": {
            "confidence_threshold": confidence_threshold,
            "split_semitone_threshold": split_semitone_threshold,
            "min_note_duration": min_note_duration,
            "unvoiced_grace_period": unvoiced_grace_period,
            "source": str(audio_path.name),
            "model": "swift-f0",
        },
    }, indent=2))
    print(f"[swift-f0] {len(notes)} notes → {out_path.name}", file=sys.stderr)
    return notes


def run_librosa_pyin(audio_path: Path, from_sec: float, to_sec: float, out_path: Path):
    """librosa.pyin — classic viterbi-smoothed F0 estimator."""
    import librosa
    import numpy as np

    audio, sr = slice_audio(audio_path, from_sec, to_sec)
    # pyin parameters tuned for vocal range
    f0, voiced_flag, voiced_prob = librosa.pyin(
        audio,
        fmin=librosa.note_to_hz("C2"),  # 65 Hz
        fmax=librosa.note_to_hz("C6"),  # 1046 Hz
        sr=sr,
        frame_length=2048,
        hop_length=512,
    )
    times = librosa.times_like(f0, sr=sr, hop_length=512) + from_sec
    out = {
        "hopSec": float(512 / sr),
        "frames": [
            {
                "t": round(float(times[i]), 4),
                "hz": round(float(f0[i]), 2) if not np.isnan(f0[i]) else None,
                "voiced": bool(voiced_flag[i]),
                "voicedProb": round(float(voiced_prob[i]), 3),
            }
            for i in range(len(f0))
        ],
    }
    out_path.write_text(json.dumps(out, indent=2))
    finite = sum(1 for f in out["frames"] if f["hz"] is not None)
    print(
        f"[librosa.pyin] {len(out['frames'])} frames, {finite} voiced → {out_path.name}",
        file=sys.stderr,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir", type=Path, help="e.g. /work/runs/kalinov-most")
    ap.add_argument("vocal_relpath", help="e.g. stems/source_(Vocals)_htdemucs_6s.flac")
    ap.add_argument("--from", dest="from_sec", type=float, required=True)
    ap.add_argument("--to", dest="to_sec", type=float, required=True)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    audio = args.run_dir / args.vocal_relpath
    if not audio.exists():
        print(f"audio not found: {audio}", file=sys.stderr)
        return 1
    out_dir = args.out or (Path(__file__).parent / "out")
    out_dir.mkdir(parents=True, exist_ok=True)
    run_id = args.run_dir.name
    tag = f"{run_id}_{args.from_sec:.1f}-{args.to_sec:.1f}"

    meta = {
        "run_id": run_id,
        "vocal": str(audio),
        "fromSec": args.from_sec,
        "toSec": args.to_sec,
    }
    (out_dir / f"{tag}_meta.json").write_text(json.dumps(meta, indent=2))

    try:
        run_basic_pitch(audio, args.from_sec, args.to_sec, out_dir / f"{tag}_basic_pitch.json")
    except Exception as e:
        print(f"[basic-pitch] FAILED: {e}", file=sys.stderr)
        import traceback; traceback.print_exc(file=sys.stderr)

    try:
        run_librosa_pyin(audio, args.from_sec, args.to_sec, out_dir / f"{tag}_librosa.json")
    except Exception as e:
        print(f"[librosa] FAILED: {e}", file=sys.stderr)
        import traceback; traceback.print_exc(file=sys.stderr)

    print(f"[done] outputs in {out_dir}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
