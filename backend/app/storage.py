"""Disk layout + _index.json read/write helpers.

Layout:
    RUNS_DIR/
    ├── _index.json                 # registry of tracks
    └── <track_id>/
        ├── source.<ext>            (uploaded file or yt-dlp download)
        ├── stems/...
        ├── manifest.json           (written when pipeline finishes)
        └── …

_index.json shape:
{
  "tracks": [
    {
      "id": "vremya-kolokolchikov-a3k9p1",
      "title": "Время колокольчиков",
      "artist": "Калинов мост",
      "status": "queued|processing|done|failed",
      "duration": 313.7,
      "created_at": "2026-05-10T14:22:31Z",
      "url": "https://youtube.com/...",   // optional
      "error": "..."                     // only when status=failed
    }
  ]
}
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from nanoid import generate as nanoid_generate
from slugify import slugify

from .config import INDEX_FILE, RUNS_DIR


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def make_track_id(title: str | None) -> str:
    base = slugify(title or "track", max_length=40, word_boundary=True, save_order=True)
    if not base:
        base = "track"
    suffix = nanoid_generate(size=6)
    return f"{base}-{suffix}"


def track_dir(track_id: str) -> Path:
    return RUNS_DIR / track_id


def ensure_runs_dir() -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    if not INDEX_FILE.exists():
        INDEX_FILE.write_text(json.dumps({"tracks": []}, ensure_ascii=False, indent=2))


def read_index() -> dict[str, Any]:
    ensure_runs_dir()
    try:
        return json.loads(INDEX_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"tracks": []}


def _atomic_write(path: Path, data: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(data, encoding="utf-8")
    os.replace(tmp, path)


def write_index(index: dict[str, Any]) -> None:
    ensure_runs_dir()
    _atomic_write(INDEX_FILE, json.dumps(index, ensure_ascii=False, indent=2))


def upsert_track(entry: dict[str, Any]) -> None:
    """Insert or update a track entry by id."""
    index = read_index()
    tracks = index.get("tracks", [])
    for i, t in enumerate(tracks):
        if t.get("id") == entry["id"]:
            tracks[i] = {**t, **entry}
            break
    else:
        tracks.append(entry)
    index["tracks"] = tracks
    write_index(index)


def get_track(track_id: str) -> Optional[dict[str, Any]]:
    for t in read_index().get("tracks", []):
        if t.get("id") == track_id:
            return t
    return None


def delete_track(track_id: str) -> bool:
    index = read_index()
    before = len(index.get("tracks", []))
    index["tracks"] = [t for t in index.get("tracks", []) if t.get("id") != track_id]
    if len(index["tracks"]) == before:
        return False
    write_index(index)
    # remove dir
    d = track_dir(track_id)
    if d.exists():
        import shutil
        shutil.rmtree(d, ignore_errors=True)
    return True


def create_track(
    track_id: str,
    title: str,
    artist: Optional[str],
    url: Optional[str],
    language: str,
) -> dict[str, Any]:
    """Register a new track in the index with status=queued."""
    entry = {
        "id": track_id,
        "title": title,
        "artist": artist,
        "url": url,
        "language": language,
        "status": "queued",
        "duration": None,
        "created_at": _now_iso(),
    }
    upsert_track(entry)
    return entry


def manifest_for(track_id: str) -> Optional[dict[str, Any]]:
    """Read the pipeline-produced manifest.json for `track_id`, or None."""
    p = track_dir(track_id) / "manifest.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return None
