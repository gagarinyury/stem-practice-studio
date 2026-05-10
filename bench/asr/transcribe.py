"""Transcribe a vocal stem with NeMo Parakeet-TDT-0.6B-v3 → lyrics.json.

Outputs:
    {
      "model": "nvidia/parakeet-tdt-0.6b-v3",
      "device": "cuda" | "cpu",
      "audio": "...flac",
      "duration": float, "elapsed": float, "rtf": float,
      "text": "...",
      "words": [{"word": str, "start": float, "end": float}, ...]
    }

API per HF model card / NeMo transcribe_speech.py:
    output = asr_model.transcribe([path], timestamps=True)
    output[0].timestamp['word'] → list of {word, start, end} dicts
"""
import argparse
import json
import sys
import time
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", type=Path)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--model", default="nvidia/parakeet-tdt-0.6b-v3")
    args = ap.parse_args()

    if not args.audio.exists():
        print(f"audio not found: {args.audio}", file=sys.stderr)
        return 2

    import torch
    import nemo.collections.asr as nemo_asr
    import soundfile as sf

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[asr] torch device: {device}  (ROCm masquerades as CUDA in PyTorch)", file=sys.stderr)
    print(f"[asr] loading {args.model}...", file=sys.stderr)

    t0 = time.perf_counter()
    asr_model = nemo_asr.models.ASRModel.from_pretrained(args.model)
    asr_model = asr_model.to(device).eval()
    print(f"[asr] model ready in {time.perf_counter() - t0:.1f}s", file=sys.stderr)

    info = sf.info(str(args.audio))
    duration = info.frames / info.samplerate
    print(f"[asr] audio: {duration:.1f}s @ {info.samplerate}Hz, {info.channels}ch", file=sys.stderr)

    t0 = time.perf_counter()
    output = asr_model.transcribe([str(args.audio)], timestamps=True)
    elapsed = time.perf_counter() - t0
    rtf = elapsed / duration if duration else 0.0
    print(f"[asr] inference: {elapsed:.1f}s  RTF={rtf:.3f}", file=sys.stderr)

    hyp = output[0]
    text = getattr(hyp, "text", "") or ""
    timestamp = getattr(hyp, "timestamp", None) or {}
    word_stamps = timestamp.get("word", []) if isinstance(timestamp, dict) else []

    words = [{"word": w["word"], "start": float(w["start"]), "end": float(w["end"])}
             for w in word_stamps]

    out = {
        "model": args.model,
        "device": device,
        "audio": args.audio.name,
        "duration": duration,
        "elapsed": elapsed,
        "rtf": rtf,
        "text": text,
        "words": words,
    }

    out_path = args.out or args.audio.with_suffix(".lyrics.json")
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"[asr] wrote {out_path}  ({len(words)} words)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
