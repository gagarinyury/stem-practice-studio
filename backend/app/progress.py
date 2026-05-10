"""Redis pub/sub helpers for job progress events.

Channel: `job:<track_id>`. Payload: JSON-encoded dict, e.g.
    {"stage": "separate", "pct": 70, "ts": "2026-05-10T..."}
    {"stage": "done", "pct": 100}
    {"stage": "error", "message": "..."}

Last-known event is also stored at key `job:<track_id>:last` so a client
that connects after a stage already fired still gets the current state.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from redis.asyncio import Redis as AsyncRedis


def _channel(track_id: str) -> str:
    return f"job:{track_id}"


def _last_key(track_id: str) -> str:
    return f"job:{track_id}:last"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


async def publish(redis: AsyncRedis, track_id: str, event: dict[str, Any]) -> None:
    payload = {**event, "ts": _now_iso()}
    data = json.dumps(payload, ensure_ascii=False)
    await redis.publish(_channel(track_id), data)
    await redis.set(_last_key(track_id), data, ex=24 * 3600)


async def get_last(redis: AsyncRedis, track_id: str) -> dict[str, Any] | None:
    raw = await redis.get(_last_key(track_id))
    if not raw:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


# Sync variant for use inside the arq worker (worker function is async, but the
# pipeline `on_progress` callback runs in a thread via `asyncio.to_thread`).
def publish_sync(redis_url: str, track_id: str, event: dict[str, Any]) -> None:
    """Fire-and-forget publish from a sync context."""
    import redis as redis_sync
    r = redis_sync.Redis.from_url(redis_url)
    payload = {**event, "ts": _now_iso()}
    data = json.dumps(payload, ensure_ascii=False)
    try:
        r.publish(_channel(track_id), data)
        r.set(_last_key(track_id), data, ex=24 * 3600)
    finally:
        try:
            r.close()
        except Exception:
            pass
