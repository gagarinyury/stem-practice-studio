"""Warmup session routes: POST /warmup/sessions, GET /warmup/sessions, GET /warmup/streak."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User, WarmupSession
from ..schemas import StreakOut, WarmupSessionIn, WarmupSessionOut
from ..security import get_current_user


router = APIRouter(prefix="/warmup", tags=["warmup"])


def _update_streak(user: User, finished_at: datetime) -> None:
    """Streak rules: if a session lands within [18h, 48h] after the last one,
    increment. If <18h apart, leave unchanged (same-day re-do). If >48h, reset to 1.
    First session ever → streak = 1.
    """
    last = user.last_session_at
    # SQLite drops tz info; assume stored times are naive UTC.
    if finished_at.tzinfo is not None:
        finished_at = finished_at.astimezone(timezone.utc).replace(tzinfo=None)
    if last is None:
        user.streak_count = 1
    else:
        delta = finished_at - last
        if delta < timedelta(hours=18):
            # same day, leave streak as-is
            pass
        elif delta <= timedelta(hours=48):
            user.streak_count = (user.streak_count or 0) + 1
        else:
            user.streak_count = 1
    user.last_session_at = finished_at


@router.post("/sessions", response_model=WarmupSessionOut)
def create_session(
    payload: WarmupSessionIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WarmupSessionOut:
    session = WarmupSession(
        user_id=user.id,
        started_at=payload.started_at,
        finished_at=payload.finished_at,
        duration_sec=payload.duration_sec,
        steps_completed=payload.steps_completed,
        steps_skipped=payload.steps_skipped,
        peak_note=payload.peak_note,
        accuracy_pct=payload.accuracy_pct,
        smoothness=payload.smoothness,
    )
    db.add(session)
    _update_streak(user, payload.finished_at)
    db.commit()
    db.refresh(session)
    return WarmupSessionOut.model_validate(session)


@router.get("/sessions", response_model=List[WarmupSessionOut])
def list_sessions(
    limit: int = Query(10, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[WarmupSessionOut]:
    rows = (
        db.query(WarmupSession)
        .filter(WarmupSession.user_id == user.id)
        .order_by(desc(WarmupSession.finished_at))
        .limit(limit)
        .all()
    )
    return [WarmupSessionOut.model_validate(r) for r in rows]


@router.get("/streak", response_model=StreakOut)
def get_streak(user: User = Depends(get_current_user)) -> StreakOut:
    return StreakOut(streak_count=user.streak_count or 0, last_session_at=user.last_session_at)
