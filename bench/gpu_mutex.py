"""Cross-process GPU mutex via flock on a shared host path.

Enable by setting env `GPU_LOCK_PATH` to a path mounted into all cooperating
containers (e.g. `/gpu-mutex/gpu.lock` mapped to host `/var/lib/gpu-mutex`).
If unset, the context manager is a no-op so behaviour stays unchanged.

Cooperative: every participant must use this lock. Non-participants will steal
the GPU. Foreign projects can use `ops/gpu-lock` shell wrapper to participate
without code changes.
"""
from __future__ import annotations

import contextlib
import fcntl
import os
import socket
import time
from pathlib import Path

GPU_LOCK_PATH = os.environ.get("GPU_LOCK_PATH", "")


@contextlib.contextmanager
def gpu_lock(label: str = ""):
    """Block until exclusive access to the GPU mutex. No-op if GPU_LOCK_PATH unset.

    Yields wait time in seconds.
    """
    if not GPU_LOCK_PATH:
        yield 0.0
        return
    path = Path(GPU_LOCK_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    with open(path, "a+") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        waited = time.perf_counter() - t0
        try:
            f.seek(0)
            f.truncate()
            f.write(f"pid={os.getpid()} host={socket.gethostname()} label={label} since={int(time.time())}\n")
            f.flush()
            yield waited
        finally:
            try:
                f.seek(0)
                f.truncate()
            except Exception:
                pass
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
