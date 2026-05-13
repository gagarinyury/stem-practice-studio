from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_TTL_SEC = 30 * 24 * 60 * 60


def cache_dir() -> Path:
    configured = os.environ.get("CACHE_DIR")
    if configured:
        return Path(configured)
    runs_dir = Path(os.environ.get("RUNS_DIR", "runs"))
    return runs_dir.with_name("cache")


def normalize(value: str | None) -> str:
    value = " ".join(str(value or "").casefold().strip().split())
    return re.sub(r"[^\wа-яё]+", "-", value, flags=re.IGNORECASE).strip("-") or "empty"


def _path(namespace: str, parts: list[Any]) -> Path:
    raw = json.dumps(parts, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    label = "-".join(normalize(str(p))[:32] for p in parts if p is not None)[:96] or "entry"
    return cache_dir() / namespace / f"{label}-{digest}.json"


def get(namespace: str, parts: list[Any], ttl_sec: int = DEFAULT_TTL_SEC) -> Any | None:
    path = _path(namespace, parts)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if time.time() - float(payload.get("created_at") or 0) > ttl_sec:
        return None
    return payload.get("value")


def set(namespace: str, parts: list[Any], value: Any) -> None:
    path = _path(namespace, parts)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.tmp")
        tmp.write_text(
            json.dumps({"created_at": time.time(), "value": value}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(tmp, path)
    except Exception:
        return
