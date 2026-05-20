"""Tests for bench.gpu_mutex — the cross-process flock helper.

These tests do NOT need GPU. They verify lock semantics with real flock(2):
- no-op when GPU_LOCK_PATH unset
- exclusive between processes (we fork a child holder)
- waiter blocks until holder releases
"""
import importlib
import multiprocessing as mp
import os
import time
from pathlib import Path

import pytest


def _load_module(env_value: str | None):
    """Reload bench.gpu_mutex picking up current env (module reads GPU_LOCK_PATH at import)."""
    if env_value is None:
        os.environ.pop("GPU_LOCK_PATH", None)
    else:
        os.environ["GPU_LOCK_PATH"] = env_value
    import bench.gpu_mutex as m
    importlib.reload(m)
    return m


def test_noop_when_env_unset(monkeypatch, tmp_path):
    monkeypatch.delenv("GPU_LOCK_PATH", raising=False)
    m = _load_module(None)
    t0 = time.perf_counter()
    with m.gpu_lock(label="test") as waited:
        assert waited == 0.0
    assert time.perf_counter() - t0 < 0.5


def test_lock_writes_holder_and_truncates(tmp_path):
    lock = tmp_path / "gpu.lock"
    m = _load_module(str(lock))
    with m.gpu_lock(label="hello"):
        content = lock.read_text()
        assert "label=hello" in content
        assert str(os.getpid()) in content
    # After release, file content is truncated to empty
    assert lock.read_text() == ""


def _hold_lock(lock_path: str, duration: float, ready_path: str):
    """Child process: take lock for `duration` sec, write a ready marker so parent knows we got it."""
    os.environ["GPU_LOCK_PATH"] = lock_path
    import importlib
    import bench.gpu_mutex as m
    importlib.reload(m)
    with m.gpu_lock(label="child-holder"):
        Path(ready_path).write_text("got-lock")
        time.sleep(duration)


def test_blocks_when_other_process_holds(tmp_path):
    lock = tmp_path / "gpu.lock"
    ready = tmp_path / "ready"
    m = _load_module(str(lock))

    ctx = mp.get_context("spawn")
    proc = ctx.Process(target=_hold_lock, args=(str(lock), 1.0, str(ready)))
    proc.start()
    try:
        # wait until child actually acquired the lock
        deadline = time.perf_counter() + 5
        while not ready.exists():
            if time.perf_counter() > deadline:
                pytest.fail("child never acquired lock")
            time.sleep(0.02)

        # Now we try to take the same lock — must wait for child to release
        t0 = time.perf_counter()
        with m.gpu_lock(label="parent-waiter") as waited:
            elapsed = time.perf_counter() - t0
        # child holds for 1s; we should have waited a meaningful fraction of that
        assert elapsed >= 0.3, f"parent acquired too fast: {elapsed:.3f}s"
        assert waited >= 0.3, f"reported wait too small: {waited:.3f}s"
    finally:
        proc.join(timeout=5)
        if proc.is_alive():
            proc.terminate()


def test_serializes_two_parents(tmp_path):
    """Two sequential lock acquisitions in the same process must both succeed."""
    lock = tmp_path / "gpu.lock"
    m = _load_module(str(lock))
    with m.gpu_lock(label="a"):
        pass
    with m.gpu_lock(label="b"):
        pass
    # No exception means lock was properly released between blocks.
