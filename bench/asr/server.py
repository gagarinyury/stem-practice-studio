import os
import time
import json
import traceback
import tempfile
from pathlib import Path
from typing import Optional

import torch
import soundfile as sf
import torchaudio.functional as taF
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

device = "cuda" if torch.cuda.is_available() else "cpu"

print(f"[server] loading nvidia/parakeet-tdt-0.6b-v3 on {device}...")
from nemo.collections.asr.parts.submodules.transducer_decoding import tdt_label_looping, rnnt_label_looping
for _mod in (tdt_label_looping, rnnt_label_looping):
    for _name in dir(_mod):
        _cls = getattr(_mod, _name)
        if isinstance(_cls, type) and hasattr(_cls, "maybe_enable_cuda_graphs"):
            _cls.maybe_enable_cuda_graphs = lambda self: None

from nemo.collections.asr.models import EncDecRNNTBPEModel
parakeet_model = EncDecRNNTBPEModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v3").to(device).eval()

print(f"[server] loading gigaam v3_rnnt and silero-vad on {device}...")
import gigaam
from silero_vad import load_silero_vad, get_speech_timestamps
gigaam_model = gigaam.load_model("v3_rnnt").to(device)
silero_vad_model = load_silero_vad()

print("[server] All models loaded. Ready to serve.")


class TranscribeRequest(BaseModel):
    audio: str
    out: str
    language: str
    engine: str = "parakeet"


@app.get("/health")
def health():
    return {
        "status": "ok",
        "ready": True,
        "device": device,
        "engines": ["parakeet", "gigaam"],
        "default_engine": "parakeet",
    }


def chunk_via_silero(audio, sr, MAX_CHUNK_SEC=25.0, MIN_CHUNK_SEC=0.4):
    wav = torch.from_numpy(audio)
    raw = get_speech_timestamps(wav, silero_vad_model, sampling_rate=sr, return_seconds=True)
    chunks = []
    for seg in raw:
        s, e = float(seg["start"]), float(seg["end"])
        while e - s > MAX_CHUNK_SEC:
            chunks.append((s, s + MAX_CHUNK_SEC))
            s += MAX_CHUNK_SEC
        if e - s >= MIN_CHUNK_SEC:
            chunks.append((s, e))
    return chunks

def _g(obj, key, default=None):
    return obj.get(key, default) if isinstance(obj, dict) else getattr(obj, key, default)

@app.post("/transcribe")
def transcribe_audio(req: TranscribeRequest):
    audio_path = Path(req.audio)
    out_path = Path(req.out)
    
    if not audio_path.exists():
        raise HTTPException(404, f"audio not found: {req.audio}")

    try:
        audio, sr = sf.read(str(audio_path), dtype="float32", always_2d=False)
        if audio.ndim == 2:
            audio = audio.mean(axis=1)
        duration = len(audio) / sr
        
        target_sr = 16000
        if sr != target_sr:
            audio = taF.resample(torch.from_numpy(audio).unsqueeze(0), orig_freq=sr, new_freq=target_sr).squeeze(0).numpy()
            sr = target_sr

        t0 = time.perf_counter()
        
        engine = (req.engine or "").lower().strip()
        if engine not in {"parakeet", "gigaam"}:
            engine = "parakeet"

        if engine == "gigaam":
            chunks = chunk_via_silero(audio, sr)
            words = []
            text_parts = []
            with tempfile.TemporaryDirectory() as td:
                for idx, (cs, ce) in enumerate(chunks):
                    chunk_audio = audio[int(cs * sr): int(ce * sr)]
                    chunk_path = Path(td) / f"chunk_{idx:03d}.wav"
                    sf.write(str(chunk_path), chunk_audio, sr, subtype="PCM_16")
                    
                    res = gigaam_model.transcribe(str(chunk_path), word_timestamps=True)
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
            
            out_data = {
                "model": "gigaam-v3_rnnt",
                "engine": "gigaam",
                "device": device,
                "audio": audio_path.name,
                "duration": duration,
                "elapsed": elapsed,
                "rtf": rtf,
                "text": " ".join(text_parts),
                "words": words,
            }
            
        else:
            output = parakeet_model.transcribe([audio], timestamps=True)
            elapsed = time.perf_counter() - t0
            rtf = elapsed / duration if duration else 0.0
            
            hyp = output[0]
            text = getattr(hyp, "text", "") or ""
            timestamp = getattr(hyp, "timestamp", None) or {}
            word_stamps = timestamp.get("word", []) if isinstance(timestamp, dict) else []
            words = [{"word": w["word"], "start": float(w["start"]), "end": float(w["end"])} for w in word_stamps]

            out_data = {
                "model": "nvidia/parakeet-tdt-0.6b-v3",
                "engine": "parakeet",
                "device": device,
                "audio": audio_path.name,
                "duration": duration,
                "elapsed": elapsed,
                "rtf": rtf,
                "text": text,
                "words": words,
            }

        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(out_data, ensure_ascii=False, indent=2))
        return {"status": "ok", "words": len(words), "elapsed": elapsed}
        
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))
