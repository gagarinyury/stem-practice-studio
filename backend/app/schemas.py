"""Pydantic schemas for request/response."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ===== Auth =====

def _check_email(v: str) -> str:
    v = (v or "").strip().lower()
    if "@" not in v or len(v) < 3:
        raise ValueError("invalid email")
    return v


class RegisterIn(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _check_email(v)


class LoginIn(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _check_email(v)


class UserOut(BaseModel):
    id: int
    email: str
    language: str
    voice_low: Optional[str] = None
    voice_high: Optional[str] = None
    voice_type: Optional[str] = None
    streak_count: int
    last_session_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AuthOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ===== Profile =====

class ProfilePatch(BaseModel):
    language: Optional[str] = None
    voice_low: Optional[str] = None
    voice_high: Optional[str] = None
    voice_type: Optional[str] = None


# ===== Warmup =====

class WarmupSessionIn(BaseModel):
    started_at: datetime
    finished_at: datetime
    duration_sec: int
    steps_completed: int = 0
    steps_skipped: int = 0
    peak_note: Optional[str] = None
    accuracy_pct: Optional[float] = None
    smoothness: Optional[str] = None


class WarmupSessionOut(BaseModel):
    id: int
    started_at: datetime
    finished_at: datetime
    duration_sec: int
    steps_completed: int
    steps_skipped: int
    peak_note: Optional[str] = None
    accuracy_pct: Optional[float] = None
    smoothness: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class StreakOut(BaseModel):
    streak_count: int
    last_session_at: Optional[datetime] = None
