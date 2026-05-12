"""Run Parakeet (EN/EU) or GigaAM (RU) on a vocal stem via the asr docker image."""
import subprocess
from pathlib import Path

ASR_IMAGE = "stem-practice-asr:rocm"
MODELS_HOST = Path("/srv/models/stem-practice-asr")
RENDER_GID = "991"
VIDEO_GID = "44"


def transcribe(vocal_stem: Path, out_path: Path, *, language: str) -> Path:
    """Pick the engine by language, write lyrics.json next to (or at) `out_path`."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    vocal_abs = vocal_stem.resolve()
    out_abs = out_path.resolve()

    import urllib.request
    import json
    
    # We call the warmed-up ASR HTTP server running in docker-compose
    url = "http://172.17.0.1:8091/transcribe"
    data = json.dumps({
        "audio": str(vocal_abs),
        "out": str(out_abs),
        "language": language
    }).encode("utf-8")
    
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            r.read()
    except Exception as e:
        # Fallback to docker run? No, just raise. The ASR server should be running!
        raise RuntimeError(f"ASR server failed: {e}")
        
    return out_path
