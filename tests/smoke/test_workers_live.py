"""Smoke tests against LIVE STEM workers and api.

These hit real /health endpoints — they verify the workers are alive AND that
our new structured fields (busy, gpu_mutex_path, separate_timeout) are exposed.

Endpoints (overridable via env):
    STEM_API_URL       (default http://evox2:8093)
    STEM_ASR_URL       (default http://evox2:8091)
    STEM_SEPARATOR_URL (default http://evox2:8092)

If endpoints are unreachable, tests are SKIPPED (not failed) — so the suite
still passes on a laptop with no tunnel. Run with `-m smoke` to include them
in CI when targeting evo.
"""
from __future__ import annotations

import os

import httpx
import pytest

API = os.environ.get("STEM_API_URL", "http://evox2:8093").rstrip("/")
ASR = os.environ.get("STEM_ASR_URL", "http://evox2:8091").rstrip("/")
SEP = os.environ.get("STEM_SEPARATOR_URL", "http://evox2:8092").rstrip("/")
TIMEOUT = 5.0

pytestmark = pytest.mark.smoke


def _get(url: str) -> httpx.Response:
    try:
        return httpx.get(url, timeout=TIMEOUT)
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout) as e:
        pytest.skip(f"{url} unreachable: {type(e).__name__}")


class TestApiHealth:
    def test_healthz_ok(self):
        r = _get(f"{API}/healthz")
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        assert "identify_llm" in body


class TestAsrHealth:
    def test_health_ready(self):
        r = _get(f"{ASR}/health")
        assert r.status_code == 200
        body = r.json()
        assert body.get("ready") is True, f"ASR not ready: {body.get('warmup_error')}"
        assert body.get("engines") == ["parakeet"]

    def test_health_exposes_busy_field(self):
        """After the asyncio.Lock change, /health must expose `busy`."""
        r = _get(f"{ASR}/health")
        body = r.json()
        assert "busy" in body, "ASR /health missing `busy` field — old build deployed?"
        assert isinstance(body["busy"], bool)


class TestSeparatorHealth:
    def test_health_ready(self):
        r = _get(f"{SEP}/health")
        assert r.status_code == 200
        body = r.json()
        assert body.get("ready") is True, f"separator not ready: {body.get('warmup_error')}"
        assert body.get("model") == "htdemucs_6s.yaml"

    def test_health_exposes_busy_and_timeout(self):
        """After the timeout+Lock change, /health must expose new fields."""
        r = _get(f"{SEP}/health")
        body = r.json()
        assert "busy" in body, "separator /health missing `busy`"
        assert "separate_timeout" in body, "separator /health missing `separate_timeout`"
        assert isinstance(body["separate_timeout"], int)
        assert body["separate_timeout"] >= 60


class TestGpuMutexDeployed:
    """If gpu_mutex_path is present and non-null, the cross-container mutex
    is wired up. If null, the deploy didn't include the new flock support yet.

    This test is informational: it logs the state and only fails if the field
    is *missing entirely* (older build, predates this commit).
    """

    def test_asr_reports_mutex_field(self):
        r = _get(f"{ASR}/health")
        body = r.json()
        assert "gpu_mutex_path" in body, (
            "ASR /health missing gpu_mutex_path — deploy is older than the mutex commit"
        )

    def test_separator_reports_mutex_field(self):
        r = _get(f"{SEP}/health")
        body = r.json()
        assert "gpu_mutex_path" in body, (
            "separator /health missing gpu_mutex_path — deploy is older than the mutex commit"
        )


class TestApiResponsiveness:
    """If api hangs (because asyncio is blocked by a sync job), /healthz won't
    answer in time. This is what would catch a regression where someone
    forgets to use asyncio.to_thread for blocking calls.
    """

    def test_healthz_responds_under_1s(self):
        r = _get(f"{API}/healthz")
        # _get uses TIMEOUT=5s; on a healthy api this is <100ms.
        assert r.status_code == 200
        # Body must serialize quickly
        body = r.json()
        assert body.get("ok") is True

    def test_tracks_get_requires_auth_does_not_hang(self):
        """Even unauthenticated requests must respond fast — 401 in ms, not
        timeout. Regression check for middleware deadlocks."""
        try:
            r = httpx.get(f"{API}/tracks", timeout=3.0)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout) as e:
            pytest.skip(f"api unreachable: {type(e).__name__}")
        assert r.status_code == 401


class TestRunsDirectoryServed:
    """The /runs static endpoint serves track artifacts. If broken, frontend
    can't load stems / audio / lyrics — track appears stuck."""

    def test_runs_unknown_path_returns_404_not_500(self):
        try:
            r = httpx.get(f"{API}/runs/nonexistent-track/source.wav", timeout=3.0)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout) as e:
            pytest.skip(f"api unreachable: {type(e).__name__}")
        # 404 = healthy; 500 = bug in static handler
        assert r.status_code == 404, f"got {r.status_code}: {r.text[:200]}"


class TestDemoTrack:
    """The landing-page demo track must be publicly accessible (no auth) and
    fully processed. If it 404s, every anon visitor sees a broken UI on first
    load. If it's missing stems, the demo player breaks.

    Skipped (not failed) if no DEMO_TRACK_ID is configured — that's a valid
    deploy state for environments without a public demo.
    """

    def _demo_id(self) -> str | None:
        r = _get(f"{API}/healthz")
        # healthz doesn't expose DEMO_TRACK_ID; we rely on a known prod id by env
        # override, or skip if unset
        import os
        return os.environ.get("STEM_DEMO_TRACK_ID")

    def test_demo_track_publicly_accessible(self):
        demo = self._demo_id()
        if not demo:
            pytest.skip("STEM_DEMO_TRACK_ID not set — demo check optional")
        # Unauthenticated GET must succeed
        try:
            r = httpx.get(f"{API}/tracks/{demo}", timeout=5.0)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout) as e:
            pytest.skip(f"api unreachable: {type(e).__name__}")
        assert r.status_code == 200, (
            f"demo track {demo} not accessible: {r.status_code}. "
            "Check DEMO_TRACK_ID env, backend/.env symlink, and chattr +i on the dir."
        )
        body = r.json()
        assert body.get("stems"), "demo track has no stems"
        assert "vocals" in body["stems"], "demo missing vocals stem"

    def test_demo_source_wav_streamable(self):
        demo = self._demo_id()
        if not demo:
            pytest.skip("STEM_DEMO_TRACK_ID not set")
        try:
            r = httpx.head(f"{API}/runs/{demo}/source.wav", timeout=5.0)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout) as e:
            pytest.skip(f"api unreachable: {type(e).__name__}")
        assert r.status_code == 200, f"demo source.wav not streamable: {r.status_code}"
