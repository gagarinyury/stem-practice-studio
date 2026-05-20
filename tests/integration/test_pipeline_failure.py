"""Tests for the failure paths: when a worker raises, the user-facing
status.json must clearly show stage=error with a useful message. Otherwise
users see a track stuck in "queued" forever — exactly what happened in the
recent 3-hour outage where we had no idea what was wrong.
"""
from __future__ import annotations

import asyncio
import importlib
import json
from pathlib import Path

import pytest


@pytest.fixture
def app_mod(tmp_path, monkeypatch):
    monkeypatch.setenv("RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:1/_unused")
    monkeypatch.setenv("LLM_MODEL", "test-llm")
    import backend.auth
    import backend.invites
    import backend.feedback
    import backend.app
    importlib.reload(backend.auth)
    importlib.reload(backend.invites)
    importlib.reload(backend.feedback)
    importlib.reload(backend.app)
    backend.auth.init_db()
    backend.invites.init_db()
    backend.feedback.init_db()
    return backend.app


def test_pipeline_failure_writes_error_stage(app_mod, monkeypatch):
    """Most critical guarantee for production debuggability: if anything
    inside `run_pipeline` raises, status.json gets stage=error with the
    exception type+message. No silent hangs in "queued".
    """
    def boom(opts):
        raise RuntimeError("simulated separator failure")

    monkeypatch.setattr(app_mod, "run_pipeline", boom, raising=True)

    track_id = "test-failure-track"
    track_path = Path(app_mod.RUNS_DIR) / track_id
    track_path.mkdir(parents=True)
    # Seed an initial queued status so we can verify it gets overwritten
    from pipeline.state import atomic_write_json
    atomic_write_json(track_path / "status.json", {
        "id": track_id, "user_id": "anon_x", "stage": "queued",
    })

    opts = app_mod.RunOpts(out_dir=track_path)

    asyncio.run(app_mod.start_job(track_id, opts, "anon_x"))

    final = json.loads((track_path / "status.json").read_text())
    assert final["stage"] == "error", f"expected stage=error, got {final.get('stage')!r}"
    assert "message" in final
    assert "simulated separator failure" in final["message"]
    assert "RuntimeError" in final["message"]


def test_pipeline_success_does_not_overwrite_with_error(app_mod, monkeypatch):
    """When run_pipeline returns normally, status.json must NOT be set to error."""
    def ok(opts):
        # Pipeline normally writes its own status.json; we just simulate the
        # final state — start_job should not clobber it.
        from pipeline.state import atomic_write_json
        atomic_write_json(opts.out_dir / "status.json", {
            "id": opts.out_dir.name, "stage": "done", "title": "Test",
        })

    monkeypatch.setattr(app_mod, "run_pipeline", ok, raising=True)

    track_id = "test-success-track"
    track_path = Path(app_mod.RUNS_DIR) / track_id
    track_path.mkdir(parents=True)
    opts = app_mod.RunOpts(out_dir=track_path)

    asyncio.run(app_mod.start_job(track_id, opts, "anon_y"))

    final = json.loads((track_path / "status.json").read_text())
    assert final["stage"] == "done"
    assert final["user_id"] == "anon_y"  # start_job stamps owner


def test_error_message_includes_user_id(app_mod, monkeypatch):
    """Owner tagging on error — needed for /tracks/<id> access checks
    to still work after a failure (otherwise the user can't see their
    own failed track)."""
    def boom(opts):
        raise ValueError("nope")

    monkeypatch.setattr(app_mod, "run_pipeline", boom, raising=True)

    track_id = "test-owner-on-error"
    track_path = Path(app_mod.RUNS_DIR) / track_id
    track_path.mkdir(parents=True)
    opts = app_mod.RunOpts(out_dir=track_path)

    asyncio.run(app_mod.start_job(track_id, opts, "user_abc"))

    final = json.loads((track_path / "status.json").read_text())
    assert final["user_id"] == "user_abc"
    assert final["stage"] == "error"
