from __future__ import annotations

import json
import os
import subprocess
import urllib.request
from pathlib import Path
from typing import Any


ASR_URL = os.environ.get("ASR_URL", "http://127.0.0.1:8091").rstrip("/")
SEPARATOR_URL = os.environ.get("SEPARATOR_URL", "http://127.0.0.1:8092").rstrip("/")

STEM_NAMES = ["Vocals", "Drums", "Bass", "Guitar", "Piano", "Other"]
INST_NAMES = ["Drums", "Bass", "Guitar", "Piano", "Other"]


def post_json(url: str, payload: dict[str, Any], timeout: int = 600) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def transcribe(audio: Path, out_path: Path, *, language: str, engine: str = "parakeet") -> dict[str, Any]:
    post_json(
        f"{ASR_URL}/transcribe",
        {
            "audio": str(audio.resolve()),
            "out": str(out_path.resolve()),
            "language": language,
            "engine": engine,
        },
        timeout=600,
    )
    return json.loads(out_path.read_text(encoding="utf-8"))


def separator_health() -> dict[str, Any]:
    req = urllib.request.Request(f"{SEPARATOR_URL}/health")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def separate(audio: Path, out_dir: Path) -> dict[str, Path]:
    stems_dir = out_dir / "stems"
    stems_dir.mkdir(parents=True, exist_ok=True)
    post_json(
        f"{SEPARATOR_URL}/separate",
        {"audio": str(audio.resolve()), "output_dir": str(out_dir.resolve())},
        timeout=900,
    )
    base = audio.stem
    stems: dict[str, Path] = {}
    for name in STEM_NAMES:
        for p in (
            stems_dir / f"{base}_({name})_htdemucs_6s.flac",
            out_dir / f"{base}_({name})_htdemucs_6s.flac",
        ):
            if p.exists():
                stems[name.lower()] = p
                break
    if "vocals" not in stems:
        raise RuntimeError(f"separator produced no vocals stem in {stems_dir} or {out_dir}")
    if "music" not in stems:
        music = merge_music(stems, out_dir)
        stems["music"] = music
    return stems


def merge_music(stems: dict[str, Path], out_dir: Path) -> Path:
    inst = [stems[n.lower()] for n in INST_NAMES if n.lower() in stems]
    if not inst:
        raise RuntimeError("no instrumental stems to merge")
    stems_dir = out_dir / "stems"
    stems_dir.mkdir(parents=True, exist_ok=True)
    music_path = stems_dir / "music.flac"
    cmd = ["ffmpeg", "-y"]
    for p in inst:
        cmd += ["-i", str(p)]
    cmd += [
        "-filter_complex",
        f"amix=inputs={len(inst)}:duration=longest:normalize=0",
        "-c:a",
        "flac",
        str(music_path),
    ]
    subprocess.run(cmd, check=True)
    return music_path
