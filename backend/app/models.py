"""ORM models. Two tables: users + warmup_sessions."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    language: Mapped[str] = mapped_column(String(32), default="English")
    voice_low: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    voice_high: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    voice_type: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    streak_count: Mapped[int] = mapped_column(Integer, default=0)
    last_session_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    sessions: Mapped[list["WarmupSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class WarmupSession(Base):
    __tablename__ = "warmup_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime)
    finished_at: Mapped[datetime] = mapped_column(DateTime)
    duration_sec: Mapped[int] = mapped_column(Integer)
    steps_completed: Mapped[int] = mapped_column(Integer, default=0)
    steps_skipped: Mapped[int] = mapped_column(Integer, default=0)
    peak_note: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    accuracy_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    smoothness: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped[User] = relationship(back_populates="sessions")
