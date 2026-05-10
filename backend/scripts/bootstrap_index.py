"""Register existing run directories in _index.json.

Used once after Phase 2 deploy to backfill tracks that were produced by the
CLI before the API existed. Idempotent: re-running won't duplicate entries.

Usage (on evo):
    python -m backend.scripts.bootstrap_index /srv/apps/stem-practice-studio/runs
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def main(runs_dir_arg: str | None = None) -> int:
    runs_dir = Path(runs_dir_arg or os.environ.get(
        "RUNS_DIR", "/srv/apps/stem-practice-studio/runs"))
    runs_dir.mkdir(parents=True, exist_ok=True)
    index_path = runs_dir / "_index.json"

    try:
        index = json.loads(index_path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        index = {"tracks": []}

    known_ids = {t.get("id") for t in index.get("tracks", [])}
    added: list[str] = []

    for child in sorted(runs_dir.iterdir()):
        if not child.is_dir():
            continue
        if child.name.startswith("_") or child.name.startswith("."):
            continue
        track_id = child.name
        manifest_path = child / "manifest.json"
        if not manifest_path.exists():
            continue
        if track_id in known_ids:
            continue
        try:
            m = json.loads(manifest_path.read_text())
        except json.JSONDecodeError:
            print(f"  [skip] {track_id}: invalid manifest.json", file=sys.stderr)
            continue
        entry = {
            "id": track_id,
            "title": m.get("title") or track_id,
            "artist": m.get("artist"),
            "url": m.get("url"),
            "language": m.get("language") or "en",
            "duration": m.get("duration"),
            "status": "done",
            "created_at": _now_iso(),
        }
        index.setdefault("tracks", []).append(entry)
        added.append(track_id)
        print(f"  [add] {track_id} — {entry['title']}")

    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n_index.json updated: +{len(added)} tracks, total {len(index['tracks'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else None))
