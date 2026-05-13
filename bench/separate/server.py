from __future__ import annotations

import json
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Stem Separator Service")

MODEL = "htdemucs_6s.yaml"
MODEL_DIR = "/models"
STEMS = ["Vocals", "Drums", "Bass", "Guitar", "Piano", "Other"]
READY = False
WARMUP_ERROR: str | None = None
WARMUP_ELAPSED: float | None = None


class SeparateRequest(BaseModel):
    audio: str
    output_dir: str


def run_separator(audio: Path, stems_dir: Path) -> float:
    stems_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "audio-separator",
        str(audio),
        "-m",
        MODEL,
        "--model_file_dir",
        MODEL_DIR,
        "--output_dir",
        str(stems_dir),
        "--output_format",
        "FLAC",
        "--demucs_shifts",
        "1",
        "--demucs_overlap",
        "0.1",
    ]
    t0 = time.perf_counter()
    subprocess.run(cmd, check=True)
    return time.perf_counter() - t0


def warmup() -> None:
    global READY, WARMUP_ERROR, WARMUP_ELAPSED
    t0 = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="stem-separator-warmup-") as td:
            td_path = Path(td)
            wav = td_path / "warmup.wav"
            sr = 44100
            seconds = 20
            t = np.linspace(0, seconds, sr * seconds, endpoint=False, dtype=np.float32)
            tone = 0.08 * np.sin(2 * np.pi * 220 * t) + 0.04 * np.sin(2 * np.pi * 440 * t)
            envelope = np.minimum(1.0, np.minimum(t / 0.25, (seconds - t) / 0.25))
            mono = (tone * envelope).astype(np.float32)
            audio = np.column_stack([mono, mono])
            sf.write(str(wav), audio, sr)
            run_separator(wav, td_path / "stems")
            vocals = td_path / "stems" / f"{wav.stem}_(Vocals)_{MODEL.removesuffix('.yaml')}.flac"
            if not vocals.exists():
                raise RuntimeError(f"separator warmup produced no vocals stem: {vocals}")
        WARMUP_ELAPSED = time.perf_counter() - t0
        READY = True
    except Exception as e:
        WARMUP_ERROR = f"{type(e).__name__}: {e}"
        WARMUP_ELAPSED = time.perf_counter() - t0
        READY = False


@app.on_event("startup")
def startup() -> None:
    warmup()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok" if READY else "warming",
        "ready": READY,
        "model": MODEL,
        "demucs_params": {"shifts": 1, "overlap": 0.1},
        "warmup_seconds": 20,
        "warmup_elapsed": WARMUP_ELAPSED,
        "warmup_error": WARMUP_ERROR,
    }


@app.post("/separate")
def separate(req: SeparateRequest) -> dict[str, Any]:
    if not READY:
        raise HTTPException(503, "separator is not ready")
    audio = Path(req.audio)
    out_dir = Path(req.output_dir)
    if not audio.exists():
        raise HTTPException(404, f"audio not found: {audio}")
    stems_dir = out_dir / "stems"
    elapsed = run_separator(audio, stems_dir)
    base = audio.stem
    stems = {}
    for name in STEMS:
        p = stems_dir / f"{base}_({name})_htdemucs_6s.flac"
        if p.exists():
            stems[name.lower()] = str(p)
    return {"status": "ok", "elapsed": elapsed, "stems": stems}
