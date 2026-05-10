"""arq worker definitions. One job runs at a time (GPU lock)."""
from __future__ import annotations

import asyncio
import traceback
from pathlib import Path
from typing import Any

from arq.connections import RedisSettings

from .config import REDIS_URL, RUNS_DIR
from .progress import publish_sync
from .storage import manifest_for, upsert_track


def _redis_settings_from_url(url: str) -> RedisSettings:
    # arq's RedisSettings has `from_dsn` in newer versions; build manually for safety.
    from urllib.parse import urlparse
    p = urlparse(url)
    return RedisSettings(
        host=p.hostname or "localhost",
        port=p.port or 6379,
        database=int((p.path or "/0").lstrip("/") or 0),
        password=p.password,
    )


async def process_track(
    ctx: dict[str, Any],
    track_id: str,
    *,
    source_path: str | None,
    url: str | None,
    language: str,
    artist: str | None,
    title: str | None,
) -> dict[str, Any]:
    """arq job: run the full pipeline for `track_id`.

    `source_path` is an absolute path inside the worker container, already
    written by the API (multipart upload). For YT, `url` is set instead.
    """
    from pipeline.process import RunOpts, run as pipeline_run

    out_dir = RUNS_DIR / track_id
    upsert_track({"id": track_id, "status": "processing"})
    publish_sync(REDIS_URL, track_id, {"stage": "queued", "pct": 0})

    def on_progress(stage: str, pct: float) -> None:
        publish_sync(REDIS_URL, track_id, {"stage": stage, "pct": pct})

    opts = RunOpts(
        out_dir=out_dir,
        input_path=Path(source_path) if source_path else None,
        url=url,
        language=language,
        artist=artist,
        title=title,
    )

    try:
        # pipeline_run is sync (calls subprocess.run). Off-thread so arq's loop
        # can keep heartbeats flowing — though with max_jobs=1 it doesn't matter.
        manifest = await asyncio.to_thread(pipeline_run, opts, on_progress)
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        traceback.print_exc()
        upsert_track({"id": track_id, "status": "failed", "error": msg})
        publish_sync(REDIS_URL, track_id, {"stage": "error", "message": msg})
        return {"ok": False, "error": msg}

    # Refresh _index entry with final metadata from manifest.
    upsert_track({
        "id": track_id,
        "status": "done",
        "title": manifest.get("title") or title,
        "artist": manifest.get("artist") or artist,
        "duration": manifest.get("duration"),
        "url": manifest.get("url") or url,
    })
    publish_sync(REDIS_URL, track_id, {"stage": "done", "pct": 100})
    return {"ok": True, "manifest": manifest}


class WorkerSettings:
    functions = [process_track]
    max_jobs = 1
    keep_result_s = 60 * 60  # 1h
    job_timeout = 60 * 30    # 30 min hard ceiling per track
    redis_settings = _redis_settings_from_url(REDIS_URL)
