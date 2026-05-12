"""Identify song artist/title using a local LLM (llama-swap / llama.cpp).

Sends the YouTube title, channel name, and a snippet of ASR words to
the local Qwen3 model.  Returns {artist, title} in ~300ms — replaces
the fragile chain of regex title-parsing, AcoustID, and Genius API.

The LLM endpoint is configured via LLM_BASE_URL env var (default:
http://localhost:8080/v1 — llama-swap).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:8080/v1")
LLM_MODEL = os.environ.get(
    "LLM_MODEL", "Qwen3-30B-Instruct (Q4_K_XL, 17gb)",
)
LLM_TIMEOUT = int(os.environ.get("LLM_TIMEOUT", "30"))

SYSTEM_PROMPT = (
    "You extract song metadata from YouTube videos. "
    "Given a YouTube title, channel name, and ASR transcript snippet, "
    "identify the performing artist and song title. "
    'Always respond with a single JSON object: {"artist":"...","title":"..."}. '
    "No thinking, no explanation."
)


def identify(
    yt_title: str,
    channel: str | None = None,
    asr_snippet: str | None = None,
) -> dict | None:
    """Call the local LLM to identify artist + title.

    Returns ``{"artist": "...", "title": "..."}`` or ``None`` on failure.
    """
    parts = [f"YouTube title: {yt_title}"]
    if channel:
        parts.append(f"Channel: {channel}")
    if asr_snippet:
        parts.append(f"ASR words: {asr_snippet}")
    user_msg = "\n".join(parts)

    body = json.dumps({
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.0,
        "max_tokens": 80,
    }).encode()

    req = urllib.request.Request(
        f"{LLM_BASE_URL}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as r:
            data = json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        print(f"[identify_llm] request failed: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[identify_llm] unexpected error: {e}", file=sys.stderr)
        return None

    try:
        text = data["choices"][0]["message"]["content"]
        result = json.loads(text)
        artist = (result.get("artist") or "").strip()
        title = (result.get("title") or "").strip()
        if not artist or not title:
            print(f"[identify_llm] empty fields in response: {text}", file=sys.stderr)
            return None
        timing_ms = 0
        if "timings" in data:
            t = data["timings"]
            timing_ms = int(t.get("prompt_ms", 0) + t.get("predicted_ms", 0))
        print(
            f"[identify_llm] {artist!r} — {title!r} ({timing_ms}ms)",
            file=sys.stderr,
        )
        return {"artist": artist, "title": title}
    except (json.JSONDecodeError, KeyError, IndexError) as e:
        raw = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        print(f"[identify_llm] parse error: {e}, raw={raw!r}", file=sys.stderr)
        return None
