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
    import soundfile as sf

    # NeMo's TDT decoder calls maybe_enable_cuda_graphs() unconditionally during
    # construction — and that method's call to cuda-python dlopens libcuda.so.1,
    # which doesn't exist on ROCm. The wrapper in this NeMo version doesn't
    # try/except, so we replace the method itself with a no-op on every transducer
    # decoding computer class before instantiating the model.
    from nemo.collections.asr.parts.submodules.transducer_decoding import (
        tdt_label_looping, rnnt_label_looping,
    )
    for _mod in (tdt_label_looping, rnnt_label_looping):
        for _name in dir(_mod):
            _cls = getattr(_mod, _name)
            if isinstance(_cls, type) and hasattr(_cls, "maybe_enable_cuda_graphs"):
                _cls.maybe_enable_cuda_graphs = lambda self: None

    # Parakeet-TDT-v3 = RNN-T-style joint with BPE tokenizer. In NeMo 2.x the
    # generic ASRModel.from_pretrained dispatcher is unreliable (instantiates
    # the abstract base) — use the concrete EncDecRNNTBPEModel directly.
    from nemo.collections.asr.models import EncDecRNNTBPEModel

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[asr] torch device: {device}  (ROCm masquerades as CUDA in PyTorch)", file=sys.stderr)
    print(f"[asr] loading {args.model}...", file=sys.stderr)

    t0 = time.perf_counter()
    asr_model = EncDecRNNTBPEModel.from_pretrained(args.model)
    asr_model = asr_model.to(device).eval()
    print(f"[asr] model ready in {time.perf_counter() - t0:.1f}s", file=sys.stderr)

    audio, sr = sf.read(str(args.audio), dtype="float32", always_2d=False)
    if audio.ndim == 2:
        audio = audio.mean(axis=1)  # downmix to mono
    duration = len(audio) / sr
    print(f"[asr] audio raw: {duration:.1f}s @ {sr}Hz mono", file=sys.stderr)

    # Parakeet expects 16 kHz mono; resample if needed.
    if sr != 16000:
        import torchaudio.functional as taF
        audio = taF.resample(
            torch.from_numpy(audio).unsqueeze(0), orig_freq=sr, new_freq=16000
        ).squeeze(0).numpy()
        sr = 16000
        print(f"[asr] resampled to 16 kHz, {len(audio)} samples", file=sys.stderr)

    t0 = time.perf_counter()
    output = asr_model.transcribe([audio], timestamps=True)
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
