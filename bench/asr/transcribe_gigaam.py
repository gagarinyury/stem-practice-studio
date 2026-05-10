"""Transcribe a Russian vocal stem with GigaAM (RNN-T) → lyrics.json.

Outputs the same shape as transcribe.py (Parakeet) so downstream tooling
doesn't care which engine produced the file:

    {
      "model": "gigaam-v3-rnnt",
      "engine": "gigaam",
      "device": "cuda" | "cpu",
      "audio": "...flac",
      "duration": float, "elapsed": float, "rtf": float,
      "text": "...",
      "words": [{"word": str, "start": float, "end": float}, ...]
    }

API per official README (https://github.com/salute-developers/GigaAM):
    model = gigaam.load_model("v3_rnnt")    # or "v3_ctc" for CTC variant
    result = model.transcribe(audio_path, word_timestamps=True)
    result.text, result.words[i].{text,start,end}
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
    ap.add_argument("--model", default="v3_rnnt",
                    help="gigaam model id (v3_rnnt | v3_ctc | v2_rnnt | ...)")
    args = ap.parse_args()

    if not args.audio.exists():
        print(f"audio not found: {args.audio}", file=sys.stderr)
        return 2

    import torch
    import gigaam

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[gigaam] device: {device}", file=sys.stderr)
    print(f"[gigaam] loading {args.model}...", file=sys.stderr)

    t0 = time.perf_counter()
    model = gigaam.load_model(args.model)
    if hasattr(model, "to"):
        model = model.to(device)
    print(f"[gigaam] model ready in {time.perf_counter() - t0:.1f}s", file=sys.stderr)

    # GigaAM's transcribe takes a path; long-audio (>30 s) auto-VADs internally
    # per the README's "long-form audio transcribation" section.
    t0 = time.perf_counter()
    result = model.transcribe(str(args.audio), word_timestamps=True)
    elapsed = time.perf_counter() - t0

    # Try to read total duration via soundfile for RTF reporting (gigaam result
    # may or may not expose it depending on version).
    import soundfile as sf
    info = sf.info(str(args.audio))
    duration = info.frames / info.samplerate
    rtf = elapsed / duration if duration else 0.0
    print(f"[gigaam] inference: {elapsed:.1f}s  RTF={rtf:.3f}", file=sys.stderr)

    text = getattr(result, "text", "") or ""
    raw_words = getattr(result, "words", []) or []

    words = []
    for w in raw_words:
        # Each word is an object/dict with .text/.start/.end (or "word"/"start"/"end").
        get = (lambda k, d=None: w[k] if k in w else d) if isinstance(w, dict) else (
            lambda k, d=None: getattr(w, k, d))
        words.append({
            "word": get("text") or get("word") or "",
            "start": float(get("start") or 0.0),
            "end": float(get("end") or 0.0),
        })

    out = {
        "model": f"gigaam-{args.model}",
        "engine": "gigaam",
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
    print(f"[gigaam] wrote {out_path}  ({len(words)} words)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
