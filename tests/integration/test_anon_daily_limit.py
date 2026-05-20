"""Integration tests for anon daily limit (HTTPException 429 path).

This is the abuse-prevention gate that keeps anonymous users from spamming
GPU resources. If broken, anon users could spin up unlimited tracks.

Tests directly exercise auth.enforce_anon_daily_limit + the SQLite-backed
counters (increment_anon_daily / get_anon_daily_count).
"""
from __future__ import annotations

import importlib
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException


@pytest.fixture
def auth_mod(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "anon.db"))
    monkeypatch.setenv("ANON_DAILY_LIMIT", "2")
    import backend.auth as m
    importlib.reload(m)
    m.init_db()
    return m


def _fake_request(ip: str = "1.2.3.4"):
    """Minimal Request stub for client_ip()."""
    req = MagicMock()
    req.headers = {}
    req.client.host = ip
    return req


def _anon_actor(id_suffix: str = "abc") -> dict:
    return {
        "id": f"anon_{id_suffix}",
        "anon": True,
        "anon_id": id_suffix,
    }


class TestAnonLimit:
    def test_first_request_under_limit_passes(self, auth_mod):
        actor = _anon_actor("user1")
        req = _fake_request()
        # 0 splits so far → pass
        auth_mod.enforce_anon_daily_limit(actor, req)  # no exception

    def test_limit_enforced_after_n_increments(self, auth_mod):
        actor = _anon_actor("user2")
        req = _fake_request()
        # ANON_DAILY_LIMIT=2 → 2 increments fill the bucket
        auth_mod.increment_anon_daily(actor["id"], "1.2.3.4")
        auth_mod.increment_anon_daily(actor["id"], "1.2.3.4")
        with pytest.raises(HTTPException) as exc:
            auth_mod.enforce_anon_daily_limit(actor, req)
        assert exc.value.status_code == 429
        body = exc.value.detail
        assert body["code"] == "daily_limit_reached"
        assert body["limit"] == 2
        assert body["count"] >= 2

    def test_ip_counter_blocks_even_with_fresh_actor(self, auth_mod):
        """A new anon cookie (different actor id) but same IP should still be
        blocked. Otherwise an attacker just clears cookies and continues."""
        # Burn through 2 requests from a clean actor on this IP
        auth_mod.increment_anon_daily("anon_old1", "8.8.8.8")
        auth_mod.increment_anon_daily("anon_old2", "8.8.8.8")  # IP counter now 2

        # New actor, same IP
        new_actor = _anon_actor("brand_new")
        req = _fake_request("8.8.8.8")
        with pytest.raises(HTTPException) as exc:
            auth_mod.enforce_anon_daily_limit(new_actor, req)
        assert exc.value.status_code == 429

    def test_authenticated_user_bypasses_limit(self, auth_mod):
        """`anon=False` actors must never trip the daily limit."""
        user = {"id": "user_x", "anon": False, "email": "x@x.com", "role": "student"}
        req = _fake_request()
        # Even if their IP has tons of anon hits, real users are exempt
        for _ in range(10):
            auth_mod.increment_anon_daily("anon_spam", "1.2.3.4")
        # No exception — user is authenticated
        auth_mod.enforce_anon_daily_limit(user, req)

    def test_x_forwarded_for_is_respected(self, auth_mod):
        """Cloudflare/reverse proxy forwards real IP — limit must use that, not
        the proxy's IP. Otherwise we'd ban the entire CF edge IP after 2 users."""
        actor = _anon_actor("cf_user")
        req = MagicMock()
        req.headers = {"x-forwarded-for": "203.0.113.5"}
        req.client.host = "10.0.0.1"  # proxy IP

        # Burn through limit on the REAL IP
        auth_mod.increment_anon_daily(actor["id"], "203.0.113.5")
        auth_mod.increment_anon_daily(actor["id"], "203.0.113.5")
        with pytest.raises(HTTPException) as exc:
            auth_mod.enforce_anon_daily_limit(actor, req)
        assert exc.value.status_code == 429

    def test_daily_count_returns_max_of_actor_and_ip(self, auth_mod):
        auth_mod.increment_anon_daily("anon_a", "1.1.1.1")
        auth_mod.increment_anon_daily("anon_a", "1.1.1.1")  # actor=2, ip=2
        auth_mod.increment_anon_daily("anon_a", "1.1.1.1")  # actor=3, ip=3
        assert auth_mod.get_anon_daily_count("anon_a", "1.1.1.1") == 3

    def test_counters_isolated_by_day(self, auth_mod, monkeypatch):
        """Counts are keyed by GMT date. Two different days = independent
        buckets, so a user who hit the limit yesterday gets fresh budget today."""
        # Today
        monkeypatch.setattr(auth_mod, "_today", lambda: "2026-05-20")
        auth_mod.increment_anon_daily("anon_t", "1.1.1.1")
        auth_mod.increment_anon_daily("anon_t", "1.1.1.1")
        assert auth_mod.get_anon_daily_count("anon_t", "1.1.1.1") == 2

        # Tomorrow — should reset
        monkeypatch.setattr(auth_mod, "_today", lambda: "2026-05-21")
        assert auth_mod.get_anon_daily_count("anon_t", "1.1.1.1") == 0
