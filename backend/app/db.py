"""SQLAlchemy engine + session. Creates tables on startup (no Alembic — single
user app, schema evolution handled by drop+recreate of dev DB)."""
from __future__ import annotations

from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import DATABASE_URL


def _ensure_sqlite_parent(url: str) -> None:
    if url.startswith("sqlite:///"):
        path = Path(url.replace("sqlite:///", "", 1))
        path.parent.mkdir(parents=True, exist_ok=True)


_ensure_sqlite_parent(DATABASE_URL)

# check_same_thread=False is required for SQLite + FastAPI threadpool.
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=_connect_args, echo=False, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Import models so their tables are registered, then create_all."""
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
