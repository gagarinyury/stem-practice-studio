"""End-to-end test of POST /tracks via TestClient with REAL ffmpeg.

Pipeline workers (asr, separator, identify-llm) are mocked so no GPU is needed.
But the file upload goes through actual multipart parsing, ffmpeg invocation
(in resolve_input), and full pipeline orchestration. This catches:

  - Multipart upload regression (the b7815c6 'Content-Length' bug)
  - Pipeline never reaches stage=done
  - status.json structure mismatches
  - file ownership / access rules for anon users
  - the /tracks/{id} GET endpoint returns the manifest
"""
from __future__ import annotations

import importlib
import json
import shutil
import time
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


pytestmark = pytest.mark.skipif(
    not shutil.which("ffmpeg"),
    reason="ffmpeg not installed — required for resolve_input",
)


def _write_real_wav(path: Path, seconds: float = 1.0, sr: int = 16000) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = int(seconds * sr)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\x00\x00" * n)


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


@pytest.fixture
def patched_workers(monkeypatch):
    """Replace network clients used inside pipeline.process.run."""
    from pipeline import clients, lyrics as lyrics_mod, identify as identify_mod

    def fake_transcribe(audio, out_path, *, language, engine="parakeet"):
        data = {
            "engine": engine,
            "duration": 1.0,
            "words": [
                {"word": "hello", "start": 0.0, "end": 0.5},
                {"word": "world", "start": 0.5, "end": 1.0},
            ],
        }
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(data))
        return data

    def fake_separate(audio, out_dir):
        stems_dir = out_dir / "stems"
        stems_dir.mkdir(parents=True, exist_ok=True)
        stems: dict[str, Path] = {}
        for name in ["vocals", "drums", "bass", "guitar", "piano", "other"]:
            p = stems_dir / f"{audio.stem}_({name.capitalize()})_htdemucs_6s.flac"
            p.write_bytes(b"fake-flac")
            stems[name] = p
        music = stems_dir / "music.flac"
        music.write_bytes(b"fake-flac")
        stems["music"] = music
        return stems

    class _NoLyrics:
        entry = None
        candidates = []
        stats = {"reason": "no-candidates"}
        lines = []
        words = []
        aligned_words = []

    monkeypatch.setattr(clients, "transcribe", fake_transcribe)
    monkeypatch.setattr(clients, "separate", fake_separate)
    monkeypatch.setattr(identify_mod, "identify_candidates", lambda *a, **kw: [])
    monkeypatch.setattr(lyrics_mod, "choose", lambda *a, **kw: _NoLyrics())


@pytest.fixture
def client(app_mod):
    with TestClient(app_mod.app) as c:
        yield c


def _wait_for_stage(track_dir: Path, stage: str, timeout: float = 10.0) -> dict:
    deadline = time.perf_counter() + timeout
    while time.perf_counter() < deadline:
        try:
            status = json.loads((track_dir / "status.json").read_text())
            if status.get("stage") == stage:
                return status
            if status.get("stage") == "error":
                raise AssertionError(f"track failed: {status.get('message')}")
        except FileNotFoundError:
            pass
        time.sleep(0.1)
    raise AssertionError(f"timeout waiting for stage={stage} in {track_dir}")


class TestEndToEndUpload:
    def test_anon_upload_reaches_done(self, client, app_mod, patched_workers, tmp_path):
        """The golden path: anon user uploads WAV → backend processes →
        status reaches done → /tracks/{id} returns full manifest."""
        wav = tmp_path / "source.wav"
        _write_real_wav(wav, seconds=1.0)

        # POST multipart upload
        with wav.open("rb") as f:
            r = client.post(
                "/tracks",
                files={"file": ("source.wav", f, "audio/wav")},
                data={"language": "en", "title": "E2E Test"},
            )
        assert r.status_code == 202, f"POST /tracks failed: {r.status_code} {r.text}"
        body = r.json()
        track_id = body["id"]
        assert track_id.startswith("e2e-test-"), f"unexpected slug: {track_id!r}"

        # Anon cookie should be set
        assert "stem_anon" in client.cookies

        # Wait for pipeline to finish (mocked workers ≈ ms)
        runs_dir = Path(app_mod.RUNS_DIR)
        track_dir = runs_dir / track_id
        status = _wait_for_stage(track_dir, "done", timeout=15.0)
        assert status["stage"] == "done"

        # GET the track manifest
        r = client.get(f"/tracks/{track_id}")
        assert r.status_code == 200, r.text
        manifest = r.json()
        assert manifest["id"] == track_id
        assert "stems" in manifest
        assert set(manifest["stems"].keys()) >= {"vocals", "drums", "bass"}

    def test_static_stems_accessible_after_upload(self, client, app_mod, patched_workers, tmp_path):
        wav = tmp_path / "input.wav"
        _write_real_wav(wav)
        with wav.open("rb") as f:
            r = client.post(
                "/tracks",
                files={"file": ("input.wav", f, "audio/wav")},
                data={"language": "en", "title": "Static Test"},
            )
        track_id = r.json()["id"]
        runs_dir = Path(app_mod.RUNS_DIR)
        _wait_for_stage(runs_dir / track_id, "done", timeout=15.0)

        # Source file accessible via /runs (anon owner)
        r = client.get(f"/runs/{track_id}/source.wav")
        assert r.status_code == 200
        assert len(r.content) > 100  # real WAV bytes

        # HEAD also works (frontend uses HEAD for polling)
        r = client.head(f"/runs/{track_id}/source.wav")
        assert r.status_code == 200

    def test_other_anon_cannot_access_my_track(self, app_mod, patched_workers, tmp_path):
        """Anon ownership isolation: a second anon cookie can't read someone
        else's track. Otherwise URL-guessing leaks user data."""
        wav = tmp_path / "private.wav"
        _write_real_wav(wav)

        # First anon client uploads
        with TestClient(app_mod.app) as alice:
            with wav.open("rb") as f:
                r = alice.post(
                    "/tracks",
                    files={"file": ("a.wav", f, "audio/wav")},
                    data={"language": "en", "title": "Private"},
                )
            track_id = r.json()["id"]

        # Second anon client (fresh cookies) tries to GET
        with TestClient(app_mod.app) as bob:
            r = bob.get(f"/tracks/{track_id}")
            assert r.status_code == 404, "anon isolation broken — Bob can see Alice's track"
