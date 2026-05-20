"""Integration tests for backend.app using FastAPI TestClient.

No real GPU, no real LLM, no real workers — the pipeline `run` is patched so we
exercise routing, auth, anon cookies, track lifecycle, and file access guards.
"""
from __future__ import annotations

import importlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def app_mod(tmp_path, monkeypatch):
    """Reload backend.app pointed at fresh tmp paths."""
    monkeypatch.setenv("RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:1/_unused")
    monkeypatch.setenv("LLM_MODEL", "test-llm")
    # Reload modules so they re-read env at import.
    import backend.auth
    import backend.invites
    import backend.feedback
    import backend.app
    importlib.reload(backend.auth)
    importlib.reload(backend.invites)
    importlib.reload(backend.feedback)
    importlib.reload(backend.app)
    # Initialize DB without calling startup (which would try to warmup LLM).
    backend.auth.init_db()
    backend.invites.init_db()
    backend.feedback.init_db()
    return backend.app


@pytest.fixture
def client(app_mod):
    with TestClient(app_mod.app) as c:
        yield c


class TestHealthz:
    def test_returns_200_with_runs_dir(self, client, tmp_path):
        r = client.get("/healthz")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["runs_dir"].endswith("runs")
        assert "identify_llm" in body


class TestAuthFlow:
    def test_register_login_logout(self, client):
        r = client.post(
            "/auth/register",
            json={"email": "test@example.com", "password": "passw0rd!"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["email"] == "test@example.com"
        # Cookie should be set
        assert "stem_session" in client.cookies

        # /auth/me works while logged in
        r = client.get("/auth/me")
        assert r.status_code == 200
        assert r.json()["user"]["email"] == "test@example.com"

        # Logout clears cookie
        r = client.post("/auth/logout")
        assert r.status_code == 200

    def test_login_wrong_password(self, client):
        client.post(
            "/auth/register",
            json={"email": "wp@example.com", "password": "passw0rd!"},
        )
        client.cookies.clear()
        r = client.post(
            "/auth/login",
            json={"email": "wp@example.com", "password": "wrong-pass"},
        )
        assert r.status_code == 401

    def test_me_unauthenticated(self, client):
        r = client.get("/auth/me")
        assert r.status_code == 401


class TestTracksList:
    def test_unauth_get_tracks_requires_login(self, client):
        # GET /tracks requires a real user (anons can't list, only create+access by id)
        r = client.get("/tracks")
        assert r.status_code == 401

    def test_auth_get_tracks_returns_empty_list(self, client):
        client.post("/auth/register", json={"email": "list@example.com", "password": "passw0rd!"})
        r = client.get("/tracks")
        assert r.status_code == 200
        assert r.json() == []

    def test_get_missing_track_returns_404(self, client):
        client.post("/auth/register", json={"email": "t@example.com", "password": "passw0rd!"})
        r = client.get("/tracks/no-such-track")
        assert r.status_code == 404


class TestTrackCreation:
    """POST /tracks: we patch run_pipeline so no actual processing happens.

    What we exercise: request validation, body parsing, slug generation,
    status.json initialization, ownership tagging.
    """

    def test_rejects_without_file_and_url(self, client):
        r = client.post("/tracks", data={"language": "ru"})
        assert r.status_code == 400

    def test_rejects_both_file_and_url(self, client, tmp_path):
        wav = tmp_path / "tiny.wav"
        wav.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt ")
        with wav.open("rb") as f:
            r = client.post(
                "/tracks",
                files={"file": ("t.wav", f, "audio/wav")},
                data={"url": "https://youtu.be/abc", "language": "ru"},
            )
        assert r.status_code == 400

    def test_rejects_unknown_asr_engine(self, client):
        r = client.post(
            "/tracks",
            data={"url": "https://youtu.be/abc", "language": "ru", "asr_engine": "whisper"},
        )
        assert r.status_code == 400

    def test_anon_creates_track_with_correct_owner(self, client, app_mod, monkeypatch):
        # Patch run_pipeline so we don't try to actually process anything
        monkeypatch.setattr(app_mod, "run_pipeline", lambda opts: None, raising=True)
        r = client.post(
            "/tracks",
            data={"url": "https://youtu.be/abc", "title": "Test Song", "language": "ru"},
        )
        assert r.status_code == 202, r.text
        body = r.json()
        assert "id" in body
        assert body["id"].startswith("test-song-")  # slugified title

        # status.json should exist with stage=queued and anon user_id
        runs_dir = Path(app_mod.RUNS_DIR)
        track_dir = runs_dir / body["id"]
        assert track_dir.exists()
        status = (track_dir / "status.json").read_text()
        assert '"stage": "queued"' in status
        assert '"anon_' in status  # owner is anon_<id>


class TestRunsStaticServing:
    def test_demo_track_accessible_without_auth(self, client, app_mod, tmp_path, monkeypatch):
        # Set DEMO_TRACK_ID and put a file there
        monkeypatch.setattr(app_mod, "DEMO_TRACK_ID", "demo-xyz", raising=True)
        runs = Path(app_mod.RUNS_DIR)
        (runs / "demo-xyz").mkdir(parents=True, exist_ok=True)
        (runs / "demo-xyz" / "source.wav").write_bytes(b"audio-bytes")
        # also create owner file pointing demo to no user
        from pipeline.state import atomic_write_json
        atomic_write_json(runs / "demo-xyz" / "status.json", {"id": "demo-xyz", "stage": "done"})

        r = client.get("/runs/demo-xyz/source.wav")
        assert r.status_code == 200
        assert r.content == b"audio-bytes"

    def test_404_for_unknown_track_file(self, client):
        r = client.get("/runs/nonexistent/source.wav")
        assert r.status_code == 404

    def test_path_traversal_blocked(self, client):
        r = client.get("/runs/..%2Fetc/passwd")
        # FastAPI/Starlette resolves this differently; either 404 or 400 is fine,
        # but never 200 with sensitive content.
        assert r.status_code in (400, 404), r.status_code
