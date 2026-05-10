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

    import soundfile as sf
    info = sf.info(str(args.audio))
    duration = info.frames / info.samplerate
    print(f"[gigaam] audio: {duration:.1f}s @ {info.samplerate}Hz", file=sys.stderr)

    # transcribe() raises ValueError for >30 s clips. Use transcribe_longform —
    # GigaAM's VAD-chunked pipeline that returns a list of segments, each with
    # text + word_timestamps.
    t0 = time.perf_counter()
    if duration > 30.0:
        segments = model.transcribe_longform(str(args.audio), word_timestamps=True)
    else:
        segments = [model.transcribe(str(args.audio), word_timestamps=True)]
    elapsed = time.perf_counter() - t0
    rtf = elapsed / duration if duration else 0.0
    print(f"[gigaam] inference: {elapsed:.1f}s  RTF={rtf:.3f}  segments={len(segments)}",
          file=sys.stderr)

    # Flatten segments into a single text + words list. GigaAM segments may be
    # objects (.text, .words) or dicts; word entries likewise. The README example
    # iterates `for word in result.words: word.text/.start/.end`.
    def _g(obj, key, default=None):
        if isinstance(obj, dict):
            return obj.get(key, default)
        return getattr(obj, key, default)

    words = []
    text_parts = []
    for seg in segments:
        seg_text = _g(seg, "text") or ""
        if seg_text:
            text_parts.append(seg_text)
        for w in (_g(seg, "words") or []):
            words.append({
                "word": _g(w, "text") or _g(w, "word") or "",
                "start": float(_g(w, "start") or 0.0),
                "end": float(_g(w, "end") or 0.0),
            })
    text = " ".join(text_parts)

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
