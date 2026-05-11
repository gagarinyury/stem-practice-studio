"""POST/GET/DELETE /tracks endpoints."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ..config import REDIS_URL
from ..jobs import _redis_settings_from_url
from ..storage import (
    create_track,
    delete_track as storage_delete_track,
    get_track,
    make_track_id,
    manifest_for,
    read_index,
    track_dir,
)


router = APIRouter()


class TrackSubmit(BaseModel):
    url: Optional[str] = None
    language: str = "en"
    artist: Optional[str] = None
    title: Optional[str] = None


async def _enqueue(track_id: str, source_path: str | None, body: TrackSubmit) -> None:
    pool = await create_pool(_redis_settings_from_url(REDIS_URL))
    try:
        await pool.enqueue_job(
            "process_track",
            track_id,
            source_path=source_path,
            url=body.url,
            language=body.language,
            artist=body.artist,
            title=body.title,
        )
    finally:
        await pool.close()


@router.post("/tracks", status_code=202)
async def submit_track(
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
    language: str = Form("en"),
    artist: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
):
    """Multipart upload OR YouTube URL (form field). Either `file` or `url` is required."""
    if not file and not url:
        raise HTTPException(400, "either `file` or `url` is required")
    if file and url:
        raise HTTPException(400, "provide only one of `file` or `url`")

    # For raw file uploads with no explicit title, fall back to the
    # original filename (sans extension) so the pipeline doesn't end up
    # with title="source" — that placeholder used to leak into LRCLib
    # search and matched garbage like "...And You Will Know Us By the
    # Trail of Dead — Source Tags & Codes".
    upload_stem = (file.filename or "").rsplit(".", 1)[0] if file else None
    effective_title = title or upload_stem
    body = TrackSubmit(url=url, language=language, artist=artist, title=effective_title)

    # Display title for the index pre-pipeline. yt-dlp will overwrite later.
    display_title = effective_title or (file.filename if file else url) or "untitled"
    track_id = make_track_id(effective_title)
    create_track(track_id, display_title, artist, url, language)

    source_path: str | None = None
    if file:
        d = track_dir(track_id)
        d.mkdir(parents=True, exist_ok=True)
        suffix = Path(file.filename or "source.mp3").suffix or ".mp3"
        dst = d / f"source{suffix}"
        with dst.open("wb") as f:
            while chunk := await file.read(1024 * 1024):
                f.write(chunk)
        source_path = str(dst)

    await _enqueue(track_id, source_path, body)
    return {"id": track_id, "status": "queued"}


@router.get("/tracks")
def list_tracks():
    return read_index().get("tracks", [])


@router.get("/tracks/{track_id}")
def get_track_full(track_id: str):
    entry = get_track(track_id)
    if not entry:
        raise HTTPException(404, f"track not found: {track_id}")
    manifest = manifest_for(track_id)
    return {**(manifest or {}), **entry}


@router.delete("/tracks/{track_id}", status_code=204)
def delete_track(track_id: str):
    if not storage_delete_track(track_id):
        raise HTTPException(404, f"track not found: {track_id}")
    return None
