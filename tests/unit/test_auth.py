"""Unit tests for backend.auth — password hashing, email normalization, user lifecycle.

Uses a temp sqlite DB per test via monkeypatched DB_PATH.
"""
import importlib
import os
from pathlib import Path

import pytest
from fastapi import HTTPException


@pytest.fixture
def auth_mod(tmp_path, monkeypatch):
    """Reload backend.auth pointed at a fresh sqlite file."""
    db = tmp_path / "auth.db"
    monkeypatch.setenv("DB_PATH", str(db))
    import backend.auth as m
    importlib.reload(m)
    m.init_db()
    yield m


class TestNormalizeEmail:
    def test_lowercases_and_trims(self, auth_mod):
        assert auth_mod.normalize_email("  Foo@Bar.COM ") == "foo@bar.com"

    def test_rejects_missing_at(self, auth_mod):
        with pytest.raises(HTTPException) as e:
            auth_mod.normalize_email("not-an-email")
        assert e.value.status_code == 400

    def test_rejects_no_tld(self, auth_mod):
        with pytest.raises(HTTPException):
            auth_mod.normalize_email("foo@bar")


class TestValidatePassword:
    def test_short_rejected(self, auth_mod):
        with pytest.raises(HTTPException) as e:
            auth_mod.validate_password("short")
        assert e.value.status_code == 400

    def test_eight_chars_ok(self, auth_mod):
        auth_mod.validate_password("12345678")  # no exception


class TestPasswordHashing:
    def test_roundtrip(self, auth_mod):
        h = auth_mod.hash_password("hunter2hunter2")
        assert h.startswith("pbkdf2_sha256$")
        assert auth_mod.verify_password("hunter2hunter2", h) is True

    def test_wrong_password_rejected(self, auth_mod):
        h = auth_mod.hash_password("correctpassword")
        assert auth_mod.verify_password("wrongpassword", h) is False

    def test_different_salts_produce_different_hashes(self, auth_mod):
        h1 = auth_mod.hash_password("samepass1")
        h2 = auth_mod.hash_password("samepass1")
        assert h1 != h2  # random salt
        assert auth_mod.verify_password("samepass1", h1)
        assert auth_mod.verify_password("samepass1", h2)

    def test_malformed_hash_rejected(self, auth_mod):
        assert auth_mod.verify_password("any", "not-a-real-hash") is False
        assert auth_mod.verify_password("any", "") is False


class TestUserLifecycle:
    def test_create_user_returns_public_fields(self, auth_mod):
        u = auth_mod.create_user("alice@example.com", "password123", "INV1", "test")
        assert u["email"] == "alice@example.com"
        assert u["role"] == "student"
        assert "password_hash" not in u

    def test_duplicate_email_rejected(self, auth_mod):
        auth_mod.create_user("dup@example.com", "password123", "INV", "test")
        with pytest.raises(HTTPException) as e:
            auth_mod.create_user("dup@example.com", "password456", "INV", "test")
        assert e.value.status_code == 409

    def test_authenticate_success(self, auth_mod):
        auth_mod.create_user("bob@example.com", "passw0rd!", "INV", "test")
        u = auth_mod.authenticate("BOB@example.com", "passw0rd!")
        assert u["email"] == "bob@example.com"

    def test_authenticate_wrong_password(self, auth_mod):
        auth_mod.create_user("c@example.com", "passw0rd!", "INV", "test")
        with pytest.raises(HTTPException) as e:
            auth_mod.authenticate("c@example.com", "wrong")
        assert e.value.status_code == 401

    def test_authenticate_unknown_email(self, auth_mod):
        with pytest.raises(HTTPException) as e:
            auth_mod.authenticate("ghost@example.com", "any")
        assert e.value.status_code == 401


class TestSessions:
    def test_create_and_lookup_session(self, auth_mod):
        u = auth_mod.create_user("s@example.com", "sessionpass", "INV", "test")
        token = auth_mod.create_session(u["id"])
        looked_up = auth_mod.get_user_by_session(token)
        assert looked_up is not None
        assert looked_up["id"] == u["id"]

    def test_invalid_token_returns_none(self, auth_mod):
        assert auth_mod.get_user_by_session("garbage-token") is None
        assert auth_mod.get_user_by_session(None) is None

    def test_delete_session(self, auth_mod):
        u = auth_mod.create_user("d@example.com", "delpass12", "INV", "test")
        token = auth_mod.create_session(u["id"])
        auth_mod.delete_session(token)
        assert auth_mod.get_user_by_session(token) is None
