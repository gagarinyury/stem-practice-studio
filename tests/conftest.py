"""Global pytest config.

Adds repo root to sys.path so `import pipeline.x` and `import backend.x` work
without a packaging step. Sets RUNS_DIR/DB_PATH to tmp paths so test app never
touches /srv/apps prod data even by accident.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Hard-redirect any default paths the app might pick up at import time.
_TMP = Path(tempfile.gettempdir()) / "stem-practice-tests"
_TMP.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("RUNS_DIR", str(_TMP / "runs"))
os.environ.setdefault("CACHE_DIR", str(_TMP / "cache"))
os.environ.setdefault("DB_PATH", str(_TMP / "test-app.db"))
os.environ.setdefault("CORS_ORIGINS", "http://localhost:4324")
# Tests must never call out to the real Identify LLM or workers.
os.environ.setdefault("LLM_BASE_URL", "http://127.0.0.1:1/_unused")
os.environ.setdefault("ASR_URL", "http://127.0.0.1:1/_unused")
os.environ.setdefault("SEPARATOR_URL", "http://127.0.0.1:1/_unused")
