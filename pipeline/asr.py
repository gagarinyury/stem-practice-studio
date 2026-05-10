"""Run Parakeet (EN/EU) or GigaAM (RU) on a vocal stem via the asr docker image."""
import subprocess
from pathlib import Path

ASR_IMAGE = "stem-practice-asr:rocm"
MODELS_HOST = Path("/srv/models/stem-practice-asr")
RENDER_GID = "991"
VIDEO_GID = "44"


def transcribe(vocal_stem: Path, out_path: Path, *, language: str, code_dir: Path) -> Path:
    """Pick the engine by language, write lyrics.json next to (or at) `out_path`."""
    script = "transcribe_gigaam.py" if language == "ru" else "transcribe.py"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "docker", "run", "--rm",
        "--device", "/dev/kfd", "--device", "/dev/dri",
        "--group-add", RENDER_GID, "--group-add", VIDEO_GID,
        "-v", f"{vocal_stem.parent}:/in:ro",
        "-v", f"{out_path.parent}:/out",
        "-v", f"{code_dir}:/code:ro",
        "-v", f"{MODELS_HOST}:/asr-models",
        ASR_IMAGE,
        "python", f"/code/{script}",
        f"/in/{vocal_stem.name}",
        "--out", f"/out/{out_path.name}",
    ]
    subprocess.run(cmd, check=True)
    return out_path
