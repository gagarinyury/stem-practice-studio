"""Run Parakeet-TDT-v3 over a vocal stem and emit lyrics.json with word timestamps.

Usage:
    python transcribe.py <audio.flac> [--out lyrics.json] [--language en]

Outputs: { "language": "...", "duration": ..., "model": "...",
           "text": "...",
           "words": [{"word": "...", "start": s, "end": s, "conf": ...}, ...] }
"""
import argparse
import json
import sys
import time
from pathlib import Path

import onnxruntime as ort
import soundfile as sf
import onnx_asr


def pick_providers() -> list[str]:
    """Prefer ROCm EP if the build supports it; otherwise fall back to CPU."""
    available = ort.get_available_providers()
    preferred = ["ROCMExecutionProvider", "MIGraphXExecutionProvider", "CPUExecutionProvider"]
    return [p for p in preferred if p in available] or ["CPUExecutionProvider"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", type=Path)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--language", default=None,
                    help="ISO code; if omitted Parakeet auto-detects across 25 EU langs")
    ap.add_argument("--model", default="nemo-parakeet-tdt-0.6b-v3",
                    help="onnx-asr model id (default: Parakeet-TDT 0.6B v3)")
    args = ap.parse_args()

    if not args.audio.exists():
        print(f"audio not found: {args.audio}", file=sys.stderr)
        return 2

    providers = pick_providers()
    print(f"[asr] providers: {providers}", file=sys.stderr)
    print(f"[asr] loading model: {args.model}", file=sys.stderr)

    t0 = time.perf_counter()
    model = onnx_asr.load_model(args.model, providers=providers)
    print(f"[asr] model loaded in {time.perf_counter() - t0:.1f}s", file=sys.stderr)

    audio, sr = sf.read(str(args.audio), dtype="float32", always_2d=False)
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    duration = len(audio) / sr
    print(f"[asr] audio: {duration:.1f}s @ {sr}Hz", file=sys.stderr)

    t0 = time.perf_counter()
    result = model.recognize(audio, sample_rate=sr, timestamps="word", language=args.language)
    elapsed = time.perf_counter() - t0
    rtf = elapsed / duration if duration else 0
    print(f"[asr] inference: {elapsed:.1f}s  RTF={rtf:.3f}", file=sys.stderr)

    # Normalize the API surface — onnx-asr returns either an object or dict-ish.
    text = getattr(result, "text", None) or (result.get("text") if isinstance(result, dict) else "")
    raw_words = getattr(result, "words", None) or (result.get("words") if isinstance(result, dict) else [])

    words = []
    for w in raw_words:
        get = w.get if isinstance(w, dict) else lambda k, default=None: getattr(w, k, default)
        words.append({
            "word": get("word") or get("text") or "",
            "start": float(get("start") or get("start_time") or 0.0),
            "end": float(get("end") or get("end_time") or 0.0),
            "conf": float(get("confidence") or get("conf") or 0.0),
        })

    out = {
        "model": args.model,
        "providers": providers,
        "audio": str(args.audio.name),
        "duration": duration,
        "elapsed": elapsed,
        "rtf": rtf,
        "language": args.language or getattr(result, "language", None),
        "text": text,
        "words": words,
    }

    out_path = args.out or args.audio.with_suffix(".lyrics.json")
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"[asr] wrote {out_path}  ({len(words)} words)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
