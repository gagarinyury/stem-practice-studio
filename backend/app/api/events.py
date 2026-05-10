"""SSE: GET /tracks/{id}/events — live progress stream from Redis pub/sub."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from redis.asyncio import Redis as AsyncRedis

from ..config import REDIS_URL
from ..progress import get_last


router = APIRouter()

KEEPALIVE_SEC = 15
TERMINAL_STAGES = {"done", "error"}


async def _event_stream(request: Request, track_id: str):
    redis = AsyncRedis.from_url(REDIS_URL, decode_responses=True)
    pubsub = redis.pubsub()
    try:
        # Replay last-known event so a late client gets current progress immediately.
        last = await get_last(redis, track_id)
        if last:
            yield f"data: {json.dumps(last, ensure_ascii=False)}\n\n"
            if last.get("stage") in TERMINAL_STAGES:
                return

        await pubsub.subscribe(f"job:{track_id}")
        while True:
            if await request.is_disconnected():
                break
            try:
                msg = await asyncio.wait_for(
                    pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0),
                    timeout=KEEPALIVE_SEC,
                )
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                continue
            if msg is None:
                continue
            data = msg.get("data")
            if not data:
                continue
            yield f"data: {data}\n\n"
            try:
                parsed = json.loads(data)
                if parsed.get("stage") in TERMINAL_STAGES:
                    break
            except json.JSONDecodeError:
                pass
    finally:
        try:
            await pubsub.unsubscribe()
            await pubsub.close()
        except Exception:
            pass
        await redis.close()


@router.get("/tracks/{track_id}/events")
async def track_events(track_id: str, request: Request):
    return StreamingResponse(
        _event_stream(request, track_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
