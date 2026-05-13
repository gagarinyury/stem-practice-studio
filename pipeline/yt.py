"""yt-dlp wrapper: download audio + extract metadata."""
import json
import subprocess
from pathlib import Path
from urllib.parse import urlparse, parse_qs


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
    """Download the best video + audio for `url` into `out_dir`. Returns (audio_path, metadata).

    metadata keys: id, title, uploader, channel, duration, language (if present)
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    out_abs = out_dir.resolve()
    clean_url = _normalize_to_single_video(url)
    video_path = out_abs / "video.mp4"
    audio_path = out_abs / "source.wav"
    opus_path = out_abs / "source.opus"
    
    # 1. Download video + audio to video.mp4
    cmd = [
        "yt-dlp",
        "-f", "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--write-info-json",
        "--no-write-playlist-metafiles",
        "--no-playlist",
        "--playlist-items", "1",
        "-o", str(video_path),
        clean_url,
    ]
    subprocess.run(cmd, check=True)

    # 2. Extract source.wav from video.mp4 using ffmpeg (needed by pipeline)
    cmd_ffmpeg = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2",
        str(audio_path),
    ]
    subprocess.run(cmd_ffmpeg, check=True)

    # 3. Create lightweight source.opus for browser streaming (~5 MB vs 95 MB WAV).
    #    The frontend loads this for instant playback while the pipeline is
    #    still processing stems. Opus is universally supported in modern browsers.
    cmd_opus = [
        "ffmpeg", "-y",
        "-i", str(audio_path),
        "-c:a", "libopus", "-b:a", "128k",
        str(opus_path),
    ]
    try:
        subprocess.run(cmd_opus, check=True)
    except subprocess.CalledProcessError:
        # Not fatal — frontend will fall back to source.wav
        pass

    # yt-dlp writes video.mp4 and video.info.json
    info_path = out_dir / "video.info.json"
    info = json.loads(info_path.read_text())
    meta = {
        "id": info.get("id"),
        "title": info.get("track") or info.get("title"),
        # yt-dlp's `artist`/`track` are music metadata. `uploader` and
        # `channel` are source metadata and must not be treated as the
        # performing artist.
        "artist": info.get("artist"),
        "creator": info.get("creator"),
        "uploader": info.get("uploader"),
        "channel": info.get("channel"),
        "duration": info.get("duration"),
        "url": url,
        # Keep raw yt-dlp fields for debugging / fallback
        "yt_title": info.get("title"),
        "yt_track": info.get("track"),
        "yt_artist": info.get("artist"),
        "yt_creator": info.get("creator"),
    }
    return audio_path, meta
