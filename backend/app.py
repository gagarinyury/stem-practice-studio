from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from nanoid import generate as nanoid_generate
from slugify import slugify

from pipeline.process import RunOpts, run as run_pipeline
from pipeline.state import atomic_write_json, read_json

RUNS_DIR = Path(os.environ.get("RUNS_DIR", "/srv/apps/stem-practice-studio/runs"))
CORS_ORIGINS = [
    o.strip() for o in os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:4323,http://localhost:4324,http://evox2:4323,http://evox2:4324,http://evo:4323,http://evo:4324",
    ).split(",")
    if o.strip()
]

app = FastAPI(title="Stem Practice Studio API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

tasks: dict[str, asyncio.Task] = {}


def now() -> float:
    return time.time()


def make_track_id(title: str | None) -> str:
    base = slugify(title or "track", max_length=40, word_boundary=True, save_order=True) or "track"
    return f"{base}-{nanoid_generate(size=6)}"


def track_dir(track_id: str) -> Path:
    return RUNS_DIR / track_id


def safe_track_dir(track_id: str) -> Path:
    if Path(track_id).name != track_id or track_id in {"", ".", ".."}:
        raise HTTPException(400, "invalid track id")
    d = track_dir(track_id)
    runs_root = RUNS_DIR.resolve()
    parent = d.resolve().parent if d.exists() else d.parent.resolve()
    if parent != runs_root:
        raise HTTPException(400, "invalid track path")
    return d


def status_for(track_id: str) -> dict:
    d = safe_track_dir(track_id)
    status = read_json(d / "status.json", {"id": track_id, "stage": "missing"})
    manifest = read_json(d / "manifest.json", {})
    merged = {**status, **manifest}
    merged["id"] = track_id
    for key in ("stage", "updated_at", "words", "candidates", "asr_engine"):
        if key in status:
            merged[key] = status[key]
    merged["timings_sec"] = status.get("timings_sec") or manifest.get("timings_sec") or {}
    return merged


def list_tracks() -> list[dict]:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    out = []
    for d in sorted([p for p in RUNS_DIR.iterdir() if p.is_dir()], key=lambda p: p.stat().st_mtime, reverse=True):
        item = status_for(d.name)
        item.setdefault("id", d.name)
        out.append(item)
    return out


async def start_job(track_id: str, opts: RunOpts) -> None:
    try:
        await asyncio.to_thread(run_pipeline, opts)
    except Exception as e:
        atomic_write_json(track_dir(track_id) / "status.json", {
            "id": track_id,
            "stage": "error",
            "message": f"{type(e).__name__}: {e}",
            "updated_at": now(),
        })


@app.on_event("startup")
def startup() -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "runs_dir": str(RUNS_DIR)}


@app.post("/tracks", status_code=202)
async def submit_track(
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
    language: str = Form("ru"),
    asr_engine: str = Form("parakeet"),
    artist: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
):
    if not file and not url:
        raise HTTPException(400, "either file or url is required")
    if file and url:
        raise HTTPException(400, "provide only file or url")
    if asr_engine not in {"parakeet", "gigaam"}:
        raise HTTPException(400, "asr_engine must be parakeet or gigaam")

    upload_stem = (file.filename or "").rsplit(".", 1)[0] if file else None
    display_title = title or upload_stem or url or "track"
    track_id = make_track_id(display_title)
    out_dir = track_dir(track_id)
    out_dir.mkdir(parents=True, exist_ok=True)

    source_path = None
    if file:
        suffix = Path(file.filename or "source.wav").suffix or ".wav"
        source_path = out_dir / f"source{suffix}"
        with source_path.open("wb") as f:
            while chunk := await file.read(1024 * 1024):
                f.write(chunk)

    atomic_write_json(out_dir / "status.json", {
        "id": track_id,
        "stage": "queued",
        "title": display_title,
        "artist": artist,
        "language": language,
        "asr_engine": asr_engine,
        "updated_at": now(),
    })

    opts = RunOpts(
        out_dir=out_dir,
        input_path=source_path,
        url=url,
        language=language,
        asr_engine=asr_engine,
        artist=artist,
        title=title,
    )
    tasks[track_id] = asyncio.create_task(start_job(track_id, opts))
    return {"id": track_id, "status": "queued"}


@app.get("/tracks")
def tracks() -> list[dict]:
    return list_tracks()


@app.get("/tracks/{track_id}")
def track(track_id: str) -> dict:
    d = safe_track_dir(track_id)
    if not d.exists():
        raise HTTPException(404, f"track not found: {track_id}")
    return status_for(track_id)


@app.delete("/tracks/{track_id}", status_code=204)
async def delete_track(track_id: str) -> Response:
    d = safe_track_dir(track_id)
    task = tasks.pop(track_id, None)
    if task and not task.done():
        task.cancel()
    if not d.exists():
        raise HTTPException(404, f"track not found: {track_id}")
    if not d.is_dir():
        raise HTTPException(400, f"track path is not a directory: {track_id}")
    shutil.rmtree(d)
    return Response(status_code=204)


async def event_stream(request: Request, track_id: str):
    d = safe_track_dir(track_id)
    if not d.exists():
        yield f"data: {json.dumps({'stage': 'error', 'message': 'track not found'}, ensure_ascii=False)}\n\n"
        return
    last = None
    while True:
        if await request.is_disconnected():
            return
        status = read_json(d / "status.json", {"id": track_id, "stage": "queued"})
        payload = json.dumps(status, ensure_ascii=False)
        if payload != last:
            last = payload
            yield f"data: {payload}\n\n"
            if status.get("stage") in {"done", "error"}:
                return
        await asyncio.sleep(0.5)


@app.get("/tracks/{track_id}/events")
async def track_events(track_id: str, request: Request):
    return StreamingResponse(
        event_stream(request, track_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


app.mount("/runs", StaticFiles(directory=str(RUNS_DIR), check_dir=False), name="runs")
