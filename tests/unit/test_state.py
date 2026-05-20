"""Unit tests for pipeline.state — atomic JSON writes, RunState."""
import json
from pathlib import Path

import pytest

from pipeline.state import RunState, atomic_write_json, read_json


def test_atomic_write_creates_file(tmp_path: Path):
    p = tmp_path / "sub" / "data.json"
    atomic_write_json(p, {"k": "v"})
    assert p.exists()
    assert json.loads(p.read_text()) == {"k": "v"}


def test_atomic_write_replaces_existing(tmp_path: Path):
    p = tmp_path / "data.json"
    atomic_write_json(p, {"v": 1})
    atomic_write_json(p, {"v": 2})
    assert json.loads(p.read_text()) == {"v": 2}


def test_atomic_write_leaves_no_tmp_file(tmp_path: Path):
    p = tmp_path / "data.json"
    atomic_write_json(p, {"x": 1})
    assert list(tmp_path.iterdir()) == [p]  # no .data.json.<pid>.<hex>.tmp leftover


def test_concurrent_writes_do_not_race(tmp_path: Path):
    """Regression test: pipeline.process.run has two parallel branches
    (lyrics + stems) that both write to status.json. If atomic_write_json
    shares a single tmp filename, os.replace races and FileNotFoundError
    leaks. This test reliably reproduced that bug with shared tmp; the fix
    uses per-call unique tmp names.
    """
    import threading
    p = tmp_path / "status.json"
    errors: list[BaseException] = []

    def writer(n: int):
        try:
            for i in range(50):
                atomic_write_json(p, {"writer": n, "i": i})
        except BaseException as e:
            errors.append(e)

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"concurrent writes raced: {errors[0]!r}"
    # Final content must be valid JSON
    json.loads(p.read_text())
    # No leftover tmp files
    leftovers = [x for x in tmp_path.iterdir() if x.name.startswith(".")]
    assert not leftovers, f"leftover tmp files: {leftovers}"


def test_read_json_returns_default_on_missing(tmp_path: Path):
    assert read_json(tmp_path / "absent.json", {"d": 1}) == {"d": 1}
    assert read_json(tmp_path / "absent.json") == {}


def test_read_json_returns_default_on_invalid(tmp_path: Path):
    p = tmp_path / "broken.json"
    p.write_text("{not valid")
    assert read_json(p, {"fallback": True}) == {"fallback": True}


class TestRunState:
    def test_event_writes_status(self, tmp_path: Path):
        s = RunState(tmp_path, "track-1")
        s.timings["asr"] = 1.23
        ev = s.event("asr_ready", words=42)
        assert ev["id"] == "track-1"
        assert ev["stage"] == "asr_ready"
        assert ev["words"] == 42
        assert ev["timings_sec"] == {"asr": 1.23}
        on_disk = json.loads((tmp_path / "status.json").read_text())
        assert on_disk["stage"] == "asr_ready"
        assert on_disk["words"] == 42

    def test_event_preserves_prior_fields(self, tmp_path: Path):
        s = RunState(tmp_path, "track-2")
        s.event("queued", title="X")
        s.event("input_ready")  # next event without title arg
        on_disk = json.loads((tmp_path / "status.json").read_text())
        assert on_disk["title"] == "X"  # carried over from previous event
        assert on_disk["stage"] == "input_ready"

    def test_manifest_overrides_id_and_timings(self, tmp_path: Path):
        s = RunState(tmp_path, "track-3")
        s.timings["total"] = 5.0
        out = s.manifest({"id": "wrong", "title": "T"})
        assert out["id"] == "track-3"  # always overridden
        assert out["timings_sec"] == {"total": 5.0}
        assert out["title"] == "T"
