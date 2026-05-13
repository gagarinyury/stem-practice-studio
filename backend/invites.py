from __future__ import annotations

import secrets
import sqlite3
import time
from typing import Any

from fastapi import HTTPException

from backend import auth


def init_db() -> None:
    with auth.connect() as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS invite_codes (
                code TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at REAL NOT NULL
            )
        """)
        con.execute("CREATE INDEX IF NOT EXISTS idx_invite_codes_active ON invite_codes(active)")


def normalize_code(code: str | None) -> str:
    return " ".join(str(code or "").split()).casefold()


def validate_invite(code: str | None) -> dict[str, Any]:
    normalized = normalize_code(code)
    if not normalized:
        raise HTTPException(403, "invite code is required")
    with auth.connect() as con:
        row = con.execute(
            "SELECT * FROM invite_codes WHERE code = ? AND active = 1",
            (normalized,),
        ).fetchone()
    if not row:
        raise HTTPException(403, "invalid invite code")
    return dict(row)


def create_or_update(code: str, label: str, active: bool = True) -> dict[str, Any]:
    normalized = normalize_code(code)
    clean_label = " ".join(str(label or "").split())
    if not normalized:
        raise ValueError("invite code is empty")
    if not clean_label:
        raise ValueError("invite label is empty")

    init_db()
    with auth.connect() as con:
        con.execute(
            """
            INSERT INTO invite_codes (code, label, active, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(code) DO UPDATE SET label = excluded.label, active = excluded.active
            """,
            (normalized, clean_label, 1 if active else 0, time.time()),
        )
        row = con.execute("SELECT * FROM invite_codes WHERE code = ?", (normalized,)).fetchone()
        return dict(row)


def disable(code: str) -> dict[str, Any]:
    normalized = normalize_code(code)
    if not normalized:
        raise ValueError("invite code is empty")
    init_db()
    with auth.connect() as con:
        row = con.execute("SELECT * FROM invite_codes WHERE code = ?", (normalized,)).fetchone()
        if not row:
            raise ValueError(f"invite code not found: {normalized}")
        con.execute("UPDATE invite_codes SET active = 0 WHERE code = ?", (normalized,))
        row = con.execute("SELECT * FROM invite_codes WHERE code = ?", (normalized,)).fetchone()
        return dict(row)


def generated_code(label: str, prefix: str = "stem") -> str:
    safe = "-".join("".join(ch for ch in part if ch.isalnum()) for part in label.casefold().split())
    safe = "-".join(part for part in safe.split("-") if part)[:24] or "invite"
    return f"{prefix}-{safe}-{secrets.token_urlsafe(4).casefold()}"
