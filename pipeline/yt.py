"""yt-dlp wrapper: download audio + extract metadata.

Runs inside the bench docker image so we don't need yt-dlp on the host.
"""
import json
import subprocess
from pathlib import Path
from urllib.parse import urlparse, parse_qs

BENCH_IMAGE = "stem-practice-bench:rocm"


def _normalize_to_single_video(url: str) -> str:
    """Strip playlist/mix context so yt-dlp can't expand a Mix/Radio into
    62 tracks. If `v=` param is present, rebuild a clean watch URL with only
    that id. youtu.be/<id> and youtube.com/shorts/<id> pass through as-is.
    Otherwise return url unchanged and rely on --no-playlist.
    """
    try:
        u = urlparse(url)
    except ValueError:
        return url
    if u.hostname and "youtu" in u.hostname:
        qs = parse_qs(u.query)
        vid = qs.get("v", [None])[0]
        if vid:
            return f"https://www.youtube.com/watch?v={vid}"
    return url


def download(url: str, out_dir: Path) -> tuple[Path, dict]:
    """Download the best audio for `url` into `out_dir`. Returns (audio_path, metadata).

    metadata keys: id, title, uploader, channel, duration, language (if present)
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    out_abs = out_dir.resolve()
    clean_url = _normalize_to_single_video(url)
    cmd = [
        "docker", "run", "--rm",
        "-v", f"{out_abs}:/out",
        BENCH_IMAGE,
        "yt-dlp",
        "-f", "bestaudio",
        "--extract-audio", "--audio-format", "wav", "--audio-quality", "0",
        "--write-info-json",
        "--no-write-playlist-metafiles",
        "--no-playlist",
        "--playlist-items", "1",
        "-o", "/out/source.%(ext)s",
        clean_url,
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
