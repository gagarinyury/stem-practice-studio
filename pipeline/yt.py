"""yt-dlp wrapper: download audio + extract metadata.

Runs inside the bench docker image so we don't need yt-dlp on the host.
"""
import json
import subprocess
from pathlib import Path

BENCH_IMAGE = "stem-practice-bench:rocm"


def download(url: str, out_dir: Path) -> tuple[Path, dict]:
    """Download the best audio for `url` into `out_dir`. Returns (audio_path, metadata).

    metadata keys: id, title, uploader, channel, duration, language (if present)
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "docker", "run", "--rm",
        "-v", f"{out_dir}:/out",
        BENCH_IMAGE,
        "yt-dlp",
        "-f", "bestaudio",
        "--extract-audio", "--audio-format", "wav", "--audio-quality", "0",
        "--write-info-json",
        "--no-playlist",
        "-o", "/out/source.%(ext)s",
        url,
    ]
    subprocess.run(cmd, check=True)

    # yt-dlp writes source.wav and source.info.json
    info_path = out_dir / "source.info.json"
    audio_path = out_dir / "source.wav"
    info = json.loads(info_path.read_text())
    meta = {
        "id": info.get("id"),
        "title": info.get("title"),
        "uploader": info.get("uploader"),
        "channel": info.get("channel"),
        "duration": info.get("duration"),
        "url": url,
    }
    return audio_path, meta
