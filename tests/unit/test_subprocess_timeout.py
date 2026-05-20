"""Tests for _run_subprocess_with_timeout — the helper that prevents zombie
audio-separator processes (root cause of the production cascade where workers
piled up over hours of GPU contention).

We use real subprocesses (sleep, true, false) — no mocking. If this code is
broken, the production server will leak processes again.
"""
from __future__ import annotations

import os
import subprocess
import time

import psutil
import pytest

from bench.separate.server import _run_subprocess_with_timeout


def test_normal_exit_returns_cleanly():
    # `true` exits 0 immediately
    _run_subprocess_with_timeout(["true"], timeout=5)


def test_nonzero_exit_raises_called_process_error():
    with pytest.raises(subprocess.CalledProcessError) as exc:
        _run_subprocess_with_timeout(["false"], timeout=5)
    assert exc.value.returncode != 0


def test_timeout_raises_timeout_expired():
    t0 = time.perf_counter()
    with pytest.raises(subprocess.TimeoutExpired):
        _run_subprocess_with_timeout(["sleep", "10"], timeout=1)
    elapsed = time.perf_counter() - t0
    # Should kill within ~1s + small overhead, NEVER wait the full 10s
    assert elapsed < 3.0, f"timeout took {elapsed:.2f}s — kill not working"


def test_timeout_actually_kills_process_no_zombies():
    """The critical test: after timeout, the child subprocess must be dead,
    not lingering as a zombie or detached process. This is what was failing
    in production — audio-separator processes accumulated for hours.
    """
    # Snapshot current sleep processes BEFORE we start
    sleeps_before = {p.pid for p in psutil.process_iter(["name"]) if p.info["name"] == "sleep"}

    with pytest.raises(subprocess.TimeoutExpired):
        _run_subprocess_with_timeout(["sleep", "30"], timeout=1)

    # Give the OS a tick to fully reap the killed child
    time.sleep(0.2)

    sleeps_after = {p.pid for p in psutil.process_iter(["name"]) if p.info["name"] == "sleep"}
    new_sleeps = sleeps_after - sleeps_before

    # No new sleep processes should be alive
    assert not new_sleeps, f"leaked subprocesses after timeout: {new_sleeps}"


def test_kill_path_logs_no_silent_hang():
    """If the kill itself hangs (e.g. SIGKILL ignored — impossible normally but
    could happen with uninterruptible D-state), we must not block forever.

    We use `sleep` which is killable, but verify the function returns control
    within a reasonable bound even when timeout=0.5 forces an immediate kill.
    """
    t0 = time.perf_counter()
    with pytest.raises(subprocess.TimeoutExpired):
        _run_subprocess_with_timeout(["sleep", "60"], timeout=0)  # immediate timeout
    elapsed = time.perf_counter() - t0
    # Should be <0.5s in practice; <2s is the absolute ceiling
    assert elapsed < 2.0, f"kill path took {elapsed:.2f}s — too slow"
