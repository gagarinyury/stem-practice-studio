"""Separate a track into 6 stems via htdemucs_6s in the bench docker image."""
import subprocess
import sys
from pathlib import Path

BENCH_IMAGE = "stem-practice-bench:rocm"
MODELS_HOST = Path("/srv/models/stem-practice")
RENDER_GID = "991"
VIDEO_GID = "44"

# audio-separator names stems with the model suffix; this is the order htdemucs_6s emits.
STEM_NAMES = ["Vocals", "Drums", "Bass", "Guitar", "Piano", "Other"]
INST_NAMES = ["Drums", "Bass", "Guitar", "Piano", "Other"]


def merge_instrumental(stems: dict[str, Path], out_dir: Path) -> Path:
    """Mix all non-vocal stems into a single ``stems/music.flac`` via ffmpeg.

    This merged file allows the frontend to load only 2 files (vocals + music)
    for instant playback, instead of downloading all 6 individual stems.
    """
    inst_paths = [stems[n.lower()] for n in INST_NAMES if n.lower() in stems]
    music_path = out_dir / "stems" / "music.flac"

    if not inst_paths:
        raise RuntimeError("no instrumental stems to merge")

    # Build ffmpeg command: multiple inputs → amix filter → single FLAC output
    cmd = ["ffmpeg", "-y"]
    for p in inst_paths:
        cmd += ["-i", str(p)]
    # amix with sum mode preserves original levels (no volume reduction)
    cmd += [
        "-filter_complex",
        f"amix=inputs={len(inst_paths)}:duration=longest:normalize=0",
        "-c:a", "flac",
        str(music_path),
    ]
    print(f"[pipeline] merging {len(inst_paths)} instrumental stems → music.flac", file=sys.stderr)
    subprocess.run(cmd, check=True)
    return music_path


def separate(audio_path: Path, out_dir: Path) -> dict[str, Path]:
    """Run htdemucs_6s on `audio_path`, drop FLAC stems into `out_dir/stems/`.

    Returns dict mapping stem name (lowercased) → output Path.
    Includes a merged ``music`` key pointing to the combined instrumental.
    """
    stems_dir = out_dir / "stems"
    stems_dir.mkdir(parents=True, exist_ok=True)
    audio_abs = audio_path.resolve()
    stems_abs = stems_dir.resolve()

    cmd = [
        "docker", "run", "--rm",
        "--device", "/dev/kfd", "--device", "/dev/dri",
        "--group-add", RENDER_GID, "--group-add", VIDEO_GID,
        "-v", f"{audio_abs.parent}:/in:ro",
        "-v", f"{stems_abs}:/out",
        "-v", f"{MODELS_HOST}:/models",
        BENCH_IMAGE,
        "audio-separator", f"/in/{audio_abs.name}",
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

    # Create merged instrumental for fast frontend loading
    try:
        music_path = merge_instrumental(out, out_dir)
        out["music"] = music_path
    except Exception as e:
        print(f"[pipeline] warning: could not merge instrumental: {e}", file=sys.stderr)

    return out
