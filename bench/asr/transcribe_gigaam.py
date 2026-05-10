"""Transcribe a Russian vocal stem with GigaAM → lyrics.json (silero-vad chunked).

GigaAM's transcribe() rejects clips >30 s, and its bundled transcribe_longform
requires pyannote VAD which is gated behind HF auth. We instead chunk with
silero-vad (open, no auth), feed each chunk to the short-form transcribe with
word_timestamps=True, and offset each chunk's word stamps by the chunk's
start time in the source audio.

Output schema mirrors transcribe.py (Parakeet) so downstream tooling is
engine-agnostic:
    { model, engine, device, audio, duration, elapsed, rtf, text, words }
"""
import argparse
import json
import sys
import tempfile
import time
from pathlib import Path


MAX_CHUNK_SEC = 25.0       # GigaAM hard-fails at >30s; leave headroom
MIN_CHUNK_SEC = 0.4        # silero sometimes emits sub-second blips; skip them
TARGET_SR = 16000


def chunk_via_silero(audio, sr):
    """Return list of (start_sec, end_sec) speech intervals, each ≤MAX_CHUNK_SEC."""
    import torch
    from silero_vad import load_silero_vad, get_speech_timestamps

    vad = load_silero_vad()
    wav = torch.from_numpy(audio)
    raw = get_speech_timestamps(wav, vad, sampling_rate=sr, return_seconds=True)
    # raw: [{'start': float_s, 'end': float_s}, ...]

    chunks: list[tuple[float, float]] = []
    for seg in raw:
        s, e = float(seg["start"]), float(seg["end"])
        # Subdivide any segment longer than MAX_CHUNK_SEC.
        while e - s > MAX_CHUNK_SEC:
            chunks.append((s, s + MAX_CHUNK_SEC))
            s += MAX_CHUNK_SEC
        if e - s >= MIN_CHUNK_SEC:
            chunks.append((s, e))
    return chunks


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", type=Path)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--model", default="v3_rnnt")
    args = ap.parse_args()

    if not args.audio.exists():
        print(f"audio not found: {args.audio}", file=sys.stderr)
        return 2

    import torch
    import soundfile as sf
    import numpy as np
    import gigaam

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[gigaam] device: {device}", file=sys.stderr)

    # Load + downmix + resample to 16 kHz mono once.
    audio, sr = sf.read(str(args.audio), dtype="float32", always_2d=False)
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    if sr != TARGET_SR:
        import torchaudio.functional as taF
        audio = taF.resample(torch.from_numpy(audio).unsqueeze(0),
                             orig_freq=sr, new_freq=TARGET_SR).squeeze(0).numpy()
        sr = TARGET_SR
    duration = len(audio) / sr
    print(f"[gigaam] audio: {duration:.1f}s @ {sr}Hz mono", file=sys.stderr)

    # VAD pass.
    t0 = time.perf_counter()
    chunks = chunk_via_silero(audio, sr)
    print(f"[gigaam] silero-vad: {len(chunks)} chunks in {time.perf_counter() - t0:.1f}s",
          file=sys.stderr)
    if not chunks:
        print("[gigaam] no speech detected; aborting.", file=sys.stderr)
        return 3

    print(f"[gigaam] loading {args.model}...", file=sys.stderr)
    t0 = time.perf_counter()
    model = gigaam.load_model(args.model)
    if hasattr(model, "to"):
        model = model.to(device)
    print(f"[gigaam] model ready in {time.perf_counter() - t0:.1f}s", file=sys.stderr)

    def _g(obj, key, default=None):
        return obj.get(key, default) if isinstance(obj, dict) else getattr(obj, key, default)

    words: list[dict] = []
    text_parts: list[str] = []

    t0 = time.perf_counter()
    with tempfile.TemporaryDirectory() as td:
        for idx, (cs, ce) in enumerate(chunks):
            chunk_audio = audio[int(cs * sr): int(ce * sr)]
            chunk_path = Path(td) / f"chunk_{idx:03d}.wav"
            sf.write(str(chunk_path), chunk_audio, sr, subtype="PCM_16")

            res = model.transcribe(str(chunk_path), word_timestamps=True)
            seg_text = _g(res, "text") or ""
            if seg_text:
                text_parts.append(seg_text)
            for w in (_g(res, "words") or []):
                words.append({
                    "word": _g(w, "text") or _g(w, "word") or "",
                    "start": float(_g(w, "start") or 0.0) + cs,
                    "end": float(_g(w, "end") or 0.0) + cs,
                })

    elapsed = time.perf_counter() - t0
    rtf = elapsed / duration if duration else 0.0
    print(f"[gigaam] inference: {elapsed:.1f}s  RTF={rtf:.3f}  words={len(words)}",
          file=sys.stderr)

    out = {
        "model": f"gigaam-{args.model}",
        "engine": "gigaam",
        "device": device,
        "audio": args.audio.name,
        "duration": duration,
        "elapsed": elapsed,
        "rtf": rtf,
        "vad": "silero-vad",
        "chunks": len(chunks),
        "text": " ".join(text_parts),
        "words": words,
    }

    out_path = args.out or args.audio.with_suffix(".lyrics.json")
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"[gigaam] wrote {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
