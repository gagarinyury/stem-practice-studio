from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request, Response


SESSION_COOKIE = "stem_session"
ANON_COOKIE = "stem_anon"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
ANON_TTL_SECONDS = 60 * 60 * 24 * 365
ANON_DAILY_LIMIT = int(os.environ.get("ANON_DAILY_LIMIT", "2"))
PBKDF2_ITERATIONS = 210_000
DB_PATH = Path(os.environ.get("DB_PATH", "/srv/apps/stem-practice-studio/data/app.db"))


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def init_db() -> None:
    with connect() as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'student',
                created_at REAL NOT NULL
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL
            )
        """)
        con.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)")
        ensure_column(con, "users", "invite_code", "TEXT")
        ensure_column(con, "users", "invite_label", "TEXT")
        con.execute("""
            CREATE TABLE IF NOT EXISTS daily_splits (
                key TEXT NOT NULL,
                day TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (key, day)
            )
        """)


def ensure_column(con: sqlite3.Connection, table: str, column: str, declaration: str) -> None:
    columns = {row["name"] for row in con.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")


def public_user(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "email": row["email"],
        "role": row["role"],
        "created_at": row["created_at"],
    }


def normalize_email(email: str) -> str:
    email = " ".join(str(email or "").split()).lower()
    if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
        raise HTTPException(400, "invalid email")
    return email


def validate_password(password: str) -> None:
    if len(password or "") < 8:
        raise HTTPException(400, "password must be at least 8 characters")


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        PBKDF2_ITERATIONS,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algo, iterations, salt_b64, digest_b64 = encoded.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def create_user(email: str, password: str, invite_code: str, invite_label: str) -> dict[str, Any]:
    email = normalize_email(email)
    validate_password(password)
    user_id = secrets.token_urlsafe(12)
    created_at = time.time()
    with connect() as con:
        try:
            con.execute(
                """
                INSERT INTO users (
                    id, email, password_hash, role, created_at, invite_code, invite_label
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, email, hash_password(password), "student", created_at, invite_code, invite_label),
            )
        except sqlite3.IntegrityError as e:
            raise HTTPException(409, "email already registered") from e
        row = con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return public_user(row)


def create_or_update_admin(email: str, password: str) -> dict[str, Any]:
    email = normalize_email(email)
    validate_password(password)
    password_hash = hash_password(password)
    created_at = time.time()
    with connect() as con:
        row = con.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if row:
            con.execute(
                "UPDATE users SET password_hash = ?, role = 'admin' WHERE email = ?",
                (password_hash, email),
            )
            row = con.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            return public_user(row)

        user_id = secrets.token_urlsafe(12)
        con.execute(
            "INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)",
            (user_id, email, password_hash, created_at),
        )
        row = con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return public_user(row)


def authenticate(email: str, password: str) -> dict[str, Any]:
    email = normalize_email(email)
    with connect() as con:
        row = con.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        raise HTTPException(401, "invalid email or password")
    return public_user(row)


def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    created_at = time.time()
    expires_at = created_at + SESSION_TTL_SECONDS
    with connect() as con:
        con.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, user_id, created_at, expires_at),
        )
    return token


def get_user_by_session(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    with connect() as con:
        row = con.execute(
            """
            SELECT users.* FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ? AND sessions.expires_at > ?
            """,
            (token, time.time()),
        ).fetchone()
    return public_user(row) if row else None


def delete_session(token: str | None) -> None:
    if not token:
        return
    with connect() as con:
        con.execute("DELETE FROM sessions WHERE token = ?", (token,))


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def require_user(request: Request) -> dict[str, Any]:
    user = get_user_by_session(request.cookies.get(SESSION_COOKIE))
    if not user:
        raise HTTPException(401, "authentication required")
    return user


def manual_password_hash(password: str) -> str:
    validate_password(password)
    return hash_password(password)


def anon_actor_id(anon_id: str) -> str:
    return f"anon_{anon_id}"


def get_or_create_anon(request: Request, response: Response) -> str:
    anon = request.cookies.get(ANON_COOKIE)
    if not anon or len(anon) < 16:
        anon = secrets.token_urlsafe(16)
        response.set_cookie(
            ANON_COOKIE,
            anon,
            max_age=ANON_TTL_SECONDS,
            httponly=True,
            samesite="lax",
            path="/",
        )
    return anon


def get_actor(request: Request, response: Response) -> dict[str, Any]:
    user = get_user_by_session(request.cookies.get(SESSION_COOKIE))
    if user:
        return {**user, "anon": False}
    anon = get_or_create_anon(request, response)
    return {
        "id": anon_actor_id(anon),
        "email": None,
        "role": "anon",
        "created_at": None,
        "anon": True,
        "anon_id": anon,
    }


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    return request.client.host if request.client else "0.0.0.0"


def _today() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def get_anon_daily_count(actor_id: str, ip: str) -> int:
    day = _today()
    with connect() as con:
        rows = con.execute(
            "SELECT count FROM daily_splits WHERE day = ? AND key IN (?, ?)",
            (day, f"actor:{actor_id}", f"ip:{ip}"),
        ).fetchall()
    return max((r["count"] for r in rows), default=0)


def increment_anon_daily(actor_id: str, ip: str) -> None:
    day = _today()
    with connect() as con:
        for key in (f"actor:{actor_id}", f"ip:{ip}"):
            con.execute(
                """
                INSERT INTO daily_splits (key, day, count) VALUES (?, ?, 1)
                ON CONFLICT(key, day) DO UPDATE SET count = count + 1
                """,
                (key, day),
            )


def enforce_anon_daily_limit(actor: dict[str, Any], request: Request) -> None:
    if not actor.get("anon"):
        return
    ip = client_ip(request)
    count = get_anon_daily_count(actor["id"], ip)
    if count >= ANON_DAILY_LIMIT:
        raise HTTPException(
            429,
            {
                "code": "daily_limit_reached",
                "limit": ANON_DAILY_LIMIT,
                "count": count,
                "message": (
                    f"Free limit reached: {ANON_DAILY_LIMIT} splits per day. "
                    "Sign up to save your history and get more."
                ),
            },
        )
