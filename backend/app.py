from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
import urllib.request
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from nanoid import generate as nanoid_generate
from slugify import slugify

from pipeline.identify import title_candidates
from pipeline.process import RunOpts, run as run_pipeline
from pipeline.lyrics import choose as choose_lyrics, confirmed_pick, fetch_candidate_entry, public_candidates
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
llm_ready = False
llm_warmup_error: str | None = None
llm_warmup_elapsed: float | None = None


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


def write_confirmed_lrc(track_id: str, candidate_id: int) -> dict:
    d = safe_track_dir(track_id)
    if not d.exists():
        raise HTTPException(404, f"track not found: {track_id}")

    asr_data = read_json(d / "lyrics.json", {})
    asr_words = asr_data.get("words") or []
    if not asr_words:
        raise HTTPException(409, "ASR output is not available")

    candidates_payload = read_json(d / "lyrics_candidates.json", {})
    lrclib_debug = candidates_payload.get("lrclib") or []
    candidate = next((c for c in lrclib_debug if c.get("id") == candidate_id), None)
    if not candidate:
        raise HTTPException(404, f"LRC candidate not found: {candidate_id}")

    entry = fetch_candidate_entry(candidate)
    if not entry:
        raise HTTPException(502, "failed to fetch LRCLib candidate")

    manifest = read_json(d / "manifest.json", {})
    duration = manifest.get("duration") or asr_data.get("duration")
    try:
        picked = confirmed_pick(entry, asr_words, duration)
    except ValueError as e:
        raise HTTPException(409, str(e)) from e

    lrc_meta = {
        "found": True,
        "artist": entry.get("artistName"),
        "title": entry.get("trackName"),
        "duration": entry.get("duration"),
        "synced": bool(entry.get("syncedLyrics")),
        "reason": "user_confirmed_lrc",
        "user_confirmed": True,
        "candidates": public_candidates(lrclib_debug),
    }

    (d / "lrc.txt").write_text("\n".join(picked.lines), encoding="utf-8")
    atomic_write_json(d / "lrc_words.json", {
        "source": "lrclib",
        **lrc_meta,
        "lines": picked.lines,
        "words": picked.words,
    })

    aligned_path = d / "lyrics_aligned.json"
    atomic_write_json(aligned_path, {
        "model": "lrc-user-confirmed-via-asr-raw",
        "engine": "lrclib+" + str(asr_data.get("engine") or manifest.get("asr_engine") or "parakeet"),
        "duration": asr_data.get("duration") or manifest.get("duration"),
        "lrc_source": lrc_meta,
        "alignment": picked.stats,
        "reason": "user_confirmed_lrc",
        "user_confirmed": True,
        "lines": picked.lines,
        "text": " ".join(w.get("word", "") for w in picked.aligned_words),
        "words": picked.aligned_words,
    })

    manifest.update({
        "title": entry.get("trackName") or manifest.get("title"),
        "artist": entry.get("artistName") or manifest.get("artist"),
        "duration": asr_data.get("duration") or manifest.get("duration"),
        "lyrics": manifest.get("lyrics") or {"raw_asr": "lyrics.json", "engine": asr_data.get("engine") or "parakeet"},
        "lrc": lrc_meta,
        "aligned": {
            "path": "lyrics_aligned.json",
            "match_rate": picked.stats.get("match_rate"),
            "matched": picked.stats.get("matched"),
            "lrc_words": picked.stats.get("lrc_words"),
            "interpolated": picked.stats.get("interpolated"),
            "asr_only": False,
            "partial": False,
            "reason": "user_confirmed_lrc",
            "user_confirmed": True,
        },
    })
    atomic_write_json(d / "manifest.json", manifest)

    status = read_json(d / "status.json", {"id": track_id})
    status.update({
        "id": track_id,
        "stage": status.get("stage") or "done",
        "title": manifest.get("title"),
        "artist": manifest.get("artist"),
        "lrc": lrc_meta,
        "aligned": manifest["aligned"],
        "updated_at": now(),
    })
    atomic_write_json(d / "status.json", status)
    return status_for(track_id)


def manual_lyrics_candidates(title: str, artist: str | None) -> list[dict]:
    title = " ".join(str(title or "").split())
    artist = " ".join(str(artist or "").split())
    if not title:
        raise HTTPException(400, "title is required")

    out: dict[tuple[str, str], dict] = {}

    def add(a: str | None, t: str | None) -> None:
        aa = " ".join(str(a or "").split())
        tt = " ".join(str(t or "").split())
        if not tt:
            return
        out.setdefault((aa.casefold(), tt.casefold()), {
            "artist": aa,
            "title": tt,
            "source": "user",
            "score": 100,
        })

    add(artist, title)
    for candidate in title_candidates(title, artist):
        add(candidate.get("artist"), candidate.get("title"))
    return list(out.values())


def write_manual_lrc_search(track_id: str, title: str, artist: str | None = None) -> dict:
    d = safe_track_dir(track_id)
    if not d.exists():
        raise HTTPException(404, f"track not found: {track_id}")

    asr_data = read_json(d / "lyrics.json", {})
    asr_words = asr_data.get("words") or []
    if not asr_words:
        raise HTTPException(409, "ASR output is not available")

    manifest = read_json(d / "manifest.json", {})
    duration = manifest.get("duration") or asr_data.get("duration")
    candidates_payload = read_json(d / "lyrics_candidates.json", {})
    existing_candidates = candidates_payload.get("candidates") or []
    manual_candidates = manual_lyrics_candidates(title, artist)
    picked = choose_lyrics(manual_candidates, asr_words, duration)

    atomic_write_json(d / "lyrics_candidates.json", {
        "candidates": existing_candidates,
        "manual_query": {"artist": artist or "", "title": title},
        "manual_candidates": manual_candidates,
        "lrclib": picked.candidates,
    })

    reason = picked.stats.get("reason")
    partial = bool(picked.stats.get("partial"))
    lrc_meta = {
        "found": bool(picked.entry),
        "manual_query": {"artist": artist or "", "title": title},
    }
    if reason:
        lrc_meta["reason"] = reason
    if partial:
        lrc_meta["partial"] = True
    if picked.candidates:
        lrc_meta["candidates"] = public_candidates(picked.candidates)
    if picked.entry:
        lrc_meta.update({
            "artist": picked.entry.get("artistName"),
            "title": picked.entry.get("trackName"),
            "duration": picked.entry.get("duration"),
            "synced": bool(picked.entry.get("syncedLyrics")),
        })
        (d / "lrc.txt").write_text("\n".join(picked.lines), encoding="utf-8")
        atomic_write_json(d / "lrc_words.json", {
            "source": "lrclib",
            **lrc_meta,
            "lines": picked.lines,
            "words": picked.words,
        })

    aligned_path = d / "lyrics_aligned.json"
    atomic_write_json(aligned_path, {
        "model": "lrc-partial-via-asr-raw" if partial else ("lrc-aligned-via-asr-raw" if picked.entry else "asr-only"),
        "engine": ("lrclib+" if picked.entry else "") + str(asr_data.get("engine") or manifest.get("asr_engine") or "parakeet"),
        "duration": asr_data.get("duration") or manifest.get("duration"),
        "lrc_source": lrc_meta if picked.entry else None,
        "alignment": picked.stats if picked.entry else None,
        "reason": reason,
        "partial": partial,
        "manual_query": {"artist": artist or "", "title": title},
        "lines": picked.lines,
        "text": " ".join(w.get("word", "") for w in picked.aligned_words),
        "words": picked.aligned_words,
    })

    manifest.update({
        "title": (picked.entry or {}).get("trackName") or title or manifest.get("title"),
        "artist": (picked.entry or {}).get("artistName") or artist or manifest.get("artist"),
        "duration": asr_data.get("duration") or manifest.get("duration"),
        "lyrics": manifest.get("lyrics") or {"raw_asr": "lyrics.json", "engine": asr_data.get("engine") or "parakeet"},
        "lrc": lrc_meta,
        "aligned": {
            "path": "lyrics_aligned.json",
            "match_rate": picked.stats.get("match_rate"),
            "matched": picked.stats.get("matched"),
            "lrc_words": picked.stats.get("lrc_words"),
            "interpolated": picked.stats.get("interpolated"),
            "asr_only": picked.stats.get("asr_only", False),
            "partial": partial,
            "reason": reason,
            "user_confirmed": picked.stats.get("user_confirmed", False),
        },
    })
    atomic_write_json(d / "manifest.json", manifest)

    status = read_json(d / "status.json", {"id": track_id})
    status.update({
        "id": track_id,
        "stage": status.get("stage") or "done",
        "title": manifest.get("title"),
        "artist": manifest.get("artist"),
        "lrc": lrc_meta,
        "aligned": manifest["aligned"],
        "updated_at": now(),
    })
    atomic_write_json(d / "status.json", status)
    return status_for(track_id)


def warmup_identify_llm() -> None:
    global llm_ready, llm_warmup_error, llm_warmup_elapsed
    base_url = os.environ.get("LLM_BASE_URL", "").rstrip("/")
    model = os.environ.get("LLM_MODEL", "")
    if not base_url or not model:
        llm_ready = False
        llm_warmup_error = "LLM_BASE_URL or LLM_MODEL is not configured"
        return

    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "Return only JSON."},
            {"role": "user", "content": 'Return {"ok":true}'},
        ],
        "temperature": 0,
        "max_tokens": 8,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
    )

    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
        llm_ready = True
        llm_warmup_error = None
    except Exception as e:
        llm_ready = False
        llm_warmup_error = f"{type(e).__name__}: {e}"
    finally:
        llm_warmup_elapsed = round(time.perf_counter() - t0, 2)


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
    warmup_identify_llm()


@app.get("/healthz")
def healthz() -> dict:
    return {
        "ok": True,
        "runs_dir": str(RUNS_DIR),
        "identify_llm": {
            "ready": llm_ready,
            "elapsed": llm_warmup_elapsed,
            "error": llm_warmup_error,
            "model": os.environ.get("LLM_MODEL"),
        },
    }


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
    if asr_engine != "parakeet":
        raise HTTPException(400, "asr_engine must be parakeet")

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


@app.post("/tracks/{track_id}/lyrics/accept")
async def accept_lyrics_candidate(track_id: str, candidate_id: int = Form(...)) -> dict:
    return await asyncio.to_thread(write_confirmed_lrc, track_id, candidate_id)


@app.post("/tracks/{track_id}/lyrics/search")
async def search_lyrics_manually(
    track_id: str,
    title: str = Form(...),
    artist: Optional[str] = Form(None),
) -> dict:
    return await asyncio.to_thread(write_manual_lrc_search, track_id, title, artist)


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
