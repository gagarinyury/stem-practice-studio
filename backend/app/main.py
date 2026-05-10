"""FastAPI app entrypoint. Mounts /tracks routes + /runs static files."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api.events import router as events_router
from .api.tracks import router as tracks_router
from .config import CORS_ORIGINS, RUNS_DIR
from .storage import ensure_runs_dir


app = FastAPI(title="Stem Practice Studio API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    ensure_runs_dir()


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


app.include_router(tracks_router)
app.include_router(events_router)

# Static stems / manifests / aligned lyrics. Mounted last so dynamic routes win.
app.mount("/runs", StaticFiles(directory=str(RUNS_DIR), check_dir=False), name="runs")
