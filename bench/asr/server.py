import os
import time
import json
import traceback
from pathlib import Path

import numpy as np
import torch
import soundfile as sf
import torchaudio.functional as taF
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

device = "cuda" if torch.cuda.is_available() else "cpu"
READY = False
WARMUP_ERROR: str | None = None
WARMUP_ELAPSED: float | None = None

print(f"[server] loading nvidia/parakeet-tdt-0.6b-v3 on {device}...")
from nemo.collections.asr.parts.submodules.transducer_decoding import tdt_label_looping, rnnt_label_looping
for _mod in (tdt_label_looping, rnnt_label_looping):
    for _name in dir(_mod):
        _cls = getattr(_mod, _name)
        if isinstance(_cls, type) and hasattr(_cls, "maybe_enable_cuda_graphs"):
            _cls.maybe_enable_cuda_graphs = lambda self: None

from nemo.collections.asr.models import EncDecRNNTBPEModel
parakeet_model = EncDecRNNTBPEModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v3").to(device).eval()

print("[server] Parakeet loaded. Waiting for startup warmup.")


class TranscribeRequest(BaseModel):
    audio: str
    out: str
    language: str
    engine: str = "parakeet"


def warmup_parakeet() -> None:
    global READY, WARMUP_ERROR, WARMUP_ELAPSED
    t0 = time.perf_counter()
    try:
        sr = 16000
        seconds = int(os.environ.get("PARAKEET_WARMUP_SECONDS", "8"))
        audio = np.zeros(sr * seconds, dtype=np.float32)
        parakeet_model.transcribe([audio], timestamps=True)
        if device == "cuda":
            torch.cuda.synchronize()
        WARMUP_ELAPSED = time.perf_counter() - t0
        READY = True
        print(f"[server] Parakeet warmup complete in {WARMUP_ELAPSED:.2f}s.")
    except Exception as e:
        WARMUP_ERROR = f"{type(e).__name__}: {e}"
        WARMUP_ELAPSED = time.perf_counter() - t0
        READY = False
        print(f"[server] Parakeet warmup failed: {WARMUP_ERROR}")


@app.on_event("startup")
def startup() -> None:
    warmup_parakeet()


@app.get("/health")
def health():
    return {
        "status": "ok" if READY else "warming",
        "ready": READY,
        "device": device,
        "engines": ["parakeet"],
        "default_engine": "parakeet",
        "warmup_seconds": int(os.environ.get("PARAKEET_WARMUP_SECONDS", "8")),
        "warmup_elapsed": WARMUP_ELAPSED,
        "warmup_error": WARMUP_ERROR,
    }


@app.post("/transcribe")
def transcribe_audio(req: TranscribeRequest):
    if not READY:
        raise HTTPException(503, f"ASR is not ready: {WARMUP_ERROR or 'warming'}")

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
        if engine != "parakeet":
            engine = "parakeet"

        output = parakeet_model.transcribe([audio], timestamps=True)
        if device == "cuda":
            torch.cuda.synchronize()
        elapsed = time.perf_counter() - t0
        rtf = elapsed / duration if duration else 0.0
        
        hyp = output[0]
        text = getattr(hyp, "text", "") or ""
        timestamp = getattr(hyp, "timestamp", None) or {}
        word_stamps = timestamp.get("word", []) if isinstance(timestamp, dict) else []
        words = [{"word": w["word"], "start": float(w["start"]), "end": float(w["end"])} for w in word_stamps]

        out_data = {
            "model": "nvidia/parakeet-tdt-0.6b-v3",
            "engine": engine,
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
