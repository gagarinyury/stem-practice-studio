"""Subprocess timeout + kill helper — extracted from bench/separate/server.py
so tests can import it without pulling numpy/soundfile/torch.

This is the function that prevents audio-separator zombies after timeout.
"""
from __future__ import annotations

import subprocess


def run_subprocess_with_timeout(cmd: list[str], timeout: int) -> None:
    """Run `cmd`; if it exceeds `timeout` seconds, kill it and raise
    `subprocess.TimeoutExpired`. Raises `CalledProcessError` on non-zero exit.

    The kill path waits up to 10s for the killed process to actually go away.
    Without this the audio-separator subprocesses accumulate forever (this was
    the root cause of the production GPU contention cascade).
    """
    proc = subprocess.Popen(cmd)
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        raise
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd)
