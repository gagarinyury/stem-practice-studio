"""Separate a track into 6 stems via htdemucs_6s in the bench docker image."""
import subprocess
from pathlib import Path

BENCH_IMAGE = "stem-practice-bench:rocm"
MODELS_HOST = Path("/srv/models/stem-practice")
RENDER_GID = "991"
VIDEO_GID = "44"

# audio-separator names stems with the model suffix; this is the order htdemucs_6s emits.
STEM_NAMES = ["Vocals", "Drums", "Bass", "Guitar", "Piano", "Other"]


def separate(audio_path: Path, out_dir: Path) -> dict[str, Path]:
    """Run htdemucs_6s on `audio_path`, drop FLAC stems into `out_dir/stems/`.

    Returns dict mapping stem name (lowercased) → output Path.
    """
    stems_dir = out_dir / "stems"
    stems_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "docker", "run", "--rm",
        "--device", "/dev/kfd", "--device", "/dev/dri",
        "--group-add", RENDER_GID, "--group-add", VIDEO_GID,
        "-v", f"{audio_path.parent}:/in:ro",
        "-v", f"{stems_dir}:/out",
        "-v", f"{MODELS_HOST}:/models",
        BENCH_IMAGE,
        "audio-separator", f"/in/{audio_path.name}",
        "-m", "htdemucs_6s.yaml",
        "--model_file_dir", "/models",
        "--output_dir", "/out",
        "--output_format", "FLAC",
    ]
    subprocess.run(cmd, check=True)

    # audio-separator file names: <input_stem>_(<StemName>)_htdemucs_6s.flac
    base = audio_path.stem
    out: dict[str, Path] = {}
    for name in STEM_NAMES:
        candidate = stems_dir / f"{base}_({name})_htdemucs_6s.flac"
        if candidate.exists():
            out[name.lower()] = candidate
    if "vocals" not in out:
        raise RuntimeError(f"no Vocals stem found in {stems_dir}")
    return out
