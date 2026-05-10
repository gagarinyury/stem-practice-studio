"""Runtime configuration sourced from environment variables."""
import os
from pathlib import Path

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
RUNS_DIR = Path(os.environ.get("RUNS_DIR", "/srv/apps/stem-practice-studio/runs"))
API_PORT = int(os.environ.get("API_PORT", "8090"))
CORS_ORIGINS = [
    o.strip() for o in os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:4323,http://evox2:4323,http://evo:4323",
    ).split(",") if o.strip()
]

INDEX_FILE = RUNS_DIR / "_index.json"
