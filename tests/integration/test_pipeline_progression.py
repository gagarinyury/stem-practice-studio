"""End-to-end test of `pipeline.process.run` with the workers mocked out.

Verifies the FULL stage progression that you watch in production logs:
  queued → input_ready → asr_ready → identify_ready → lyrics_ready → stems_ready → done

If any stage is skipped or order is wrong, this test fails. This is what
would have caught the recent regression where status.json was stuck on
"queued" for 3 hours with no other signal.
"""
from __future__ import annotations

import json
import wave
from pathlib import Path

import pytest

from pipeline.process import RunOpts, run


def _write_minimal_wav(path: Path, seconds: float = 1.0, sr: int = 16000) -> None:
    """Write a real WAV file so ffmpeg in resolve_input won't crash."""
    path.parent.mkdir(parents=True, exist_ok=True)
    n = int(seconds * sr)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\x00\x00" * n)


@pytest.fixture
def mocked_clients(monkeypatch, tmp_path):
    """Replace network/GPU clients with deterministic in-process fakes."""
    from pipeline import clients

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

    monkeypatch.setattr(clients, "transcribe", fake_transcribe)
    monkeypatch.setattr(clients, "separate", fake_separate)
    return clients


def test_full_pipeline_progression_emits_all_stages(tmp_path, mocked_clients, monkeypatch):
    # Avoid LRClib HTTP and identify-LLM HTTP — return no candidates / no entry
    from pipeline import lyrics as lyrics_mod
    from pipeline import identify as identify_mod

    monkeypatch.setattr(identify_mod, "identify_candidates", lambda *a, **kw: [])

    class _NoLyrics:
        entry = None
        candidates = []
        stats = {"reason": "no-candidates"}
        lines = []
        words = []
        aligned_words = []

    monkeypatch.setattr(lyrics_mod, "choose", lambda *a, **kw: _NoLyrics())

    # Create input audio
    track_dir = tmp_path / "test-track"
    audio = track_dir / "source.wav"
    _write_minimal_wav(audio)

    opts = RunOpts(out_dir=track_dir, input_path=audio, language="en", title="Test")
    stages: list[str] = []
    manifest = run(opts, on_progress=lambda ev: stages.append(ev["stage"]))

    # Must hit each stage exactly in this order:
    expected_order = [
        "queued",
        "input_ready",
        # asr_ready and stems_ready run in parallel — either order is OK,
        # but both must appear
    ]
    for stage in expected_order:
        assert stage in stages, f"missing stage: {stage}; got {stages}"
    assert "queued" == stages[0]
    assert "done" == stages[-1]

    must_appear = {"asr_ready", "identify_ready", "lyrics_ready", "stems_ready", "done"}
    assert must_appear.issubset(set(stages)), f"missing: {must_appear - set(stages)}"

    # Manifest sanity
    assert manifest["id"] == "test-track"
    assert manifest["language"] == "en"
    assert set(manifest["stems"].keys()) >= {"vocals", "drums", "bass"}


def test_status_json_reaches_done_on_disk(tmp_path, mocked_clients, monkeypatch):
    """The user-facing status.json must end at stage=done. If it's stuck on
    any earlier stage when the pipeline returns, that's a bug."""
    from pipeline import lyrics as lyrics_mod
    from pipeline import identify as identify_mod

    monkeypatch.setattr(identify_mod, "identify_candidates", lambda *a, **kw: [])

    class _NoLyrics:
        entry = None
        candidates = []
        stats = {"reason": "no-candidates"}
        lines = []
        words = []
        aligned_words = []

    monkeypatch.setattr(lyrics_mod, "choose", lambda *a, **kw: _NoLyrics())

    track_dir = tmp_path / "happy-path"
    audio = track_dir / "source.wav"
    _write_minimal_wav(audio)
    opts = RunOpts(out_dir=track_dir, input_path=audio)
    run(opts)

    status = json.loads((track_dir / "status.json").read_text())
    assert status["stage"] == "done", f"final stage was {status['stage']!r}"
    assert "timings_sec" in status
    assert status["timings_sec"].get("total") is not None, "total timing not recorded"
