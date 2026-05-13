from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any


def atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path, default: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {} if default is None else default


class RunState:
    def __init__(self, run_dir: Path, track_id: str):
        self.run_dir = run_dir
        self.track_id = track_id
        self.timings: dict[str, float] = {}
        self.status_path = run_dir / "status.json"
        self.manifest_path = run_dir / "manifest.json"

    def event(self, stage: str, **extra: Any) -> dict[str, Any]:
        data = read_json(self.status_path, {"id": self.track_id})
        data.update({
            "id": self.track_id,
            "stage": stage,
            "updated_at": time.time(),
            "timings_sec": dict(self.timings),
        })
        data.update(extra)
        atomic_write_json(self.status_path, data)
        return data

    def manifest(self, data: dict[str, Any]) -> dict[str, Any]:
        data = {**data, "id": self.track_id, "timings_sec": dict(self.timings)}
        atomic_write_json(self.manifest_path, data)
        return data

