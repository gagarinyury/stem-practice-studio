from __future__ import annotations

import secrets
import time
from typing import Any

from backend import auth


def init_db() -> None:
    with auth.connect() as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS feedback (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                email TEXT NOT NULL,
                rating INTEGER,
                message TEXT NOT NULL,
                track_count INTEGER NOT NULL,
                created_at REAL NOT NULL
            )
        """)
        con.execute("CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at)")


def save(user: dict[str, Any], rating: int | None, message: str, track_count: int) -> dict[str, Any]:
    clean_message = " ".join(message.split()) if message else ""
    if len(clean_message) > 4000:
        clean_message = clean_message[:4000]

    feedback_id = secrets.token_urlsafe(12)
    with auth.connect() as con:
        con.execute(
            """
            INSERT INTO feedback (
                id, user_id, email, rating, message, track_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                feedback_id,
                user["id"],
                user["email"],
                rating,
                clean_message,
                track_count,
                time.time(),
            ),
        )

    return {"id": feedback_id, "ok": True}
