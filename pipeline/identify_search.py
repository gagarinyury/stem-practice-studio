"""Identify song artist/title using DuckDuckGo + a dedicated small local LLM.

1. Takes a snippet of raw ASR text.
2. Searches DuckDuckGo for `lyrics <snippet>`.
3. Passes the search results to a small warmed LLM to extract JSON {artist, title}.

Extremely fast (~1s total) and reliable without any API keys.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from html import unescape

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://172.17.0.1:8083/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "qwen3.5-2b")

SYSTEM_PROMPT = (
    "Extract artist and song title from these search results. "
    "Clean up the title by removing any live performance metadata, locations, dates, "
    "and unnecessary text in brackets (e.g., '(СПБ 03.04.2016)', '(Live)', '(Official Video)', etc.). "
    'Return ONLY JSON: {"artist":"...","title":"..."}. '
    "Do not include any explanation or markdown formatting outside the JSON."
)

TITLE_NOISE = re.compile(
    r"\b(?:lyrics?|текст\s+и\s+слова(?:\s+песни)?|текст(?:\s+песни)?|"
    r"слова(?:\s+песни)?|official|video|клип|youtube)\b",
    re.IGNORECASE | re.UNICODE,
)


def clean_text(value: str) -> str:
    value = unescape(re.sub(r"<[^>]+>", "", value))
    value = re.sub(r"\([^)]*\)", " ", value)
    value = re.sub(r"\[[^\]]*\]", " ", value)
    value = TITLE_NOISE.sub(" ", value)
    value = re.split(r"\s+\|\s+", value, maxsplit=1)[0]
    return " ".join(value.strip(" -—–~:").split())


def parse_json_content(content: str) -> dict | None:
    content = content.strip()
    if content.startswith("```json"):
        content = content[7:]
    if content.startswith("```"):
        content = content[3:]
    if content.endswith("```"):
        content = content[:-3]
    content = content.strip()
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if match:
        content = match.group(0)
    data = json.loads(content)
    artist = clean_text(str(data.get("artist") or ""))
    title = clean_text(str(data.get("title") or data.get("song") or data.get("song_title") or ""))
    if artist and title:
        return {"artist": artist, "title": title}
    return None


def parse_result_title(result: str) -> dict | None:
    text = clean_text(result)
    parts = [p.strip() for p in re.split(r"\s+[-—–~]\s+", text, maxsplit=1) if p.strip()]
    if len(parts) != 2:
        return None
    artist, title = clean_text(parts[0]), clean_text(parts[1])
    if artist and title:
        return {"artist": artist, "title": title}
    return None

def search_and_identify(asr_snippet: str) -> dict | None:
    """Search DDG with the snippet and extract artist/title via LLM."""
    if not asr_snippet or len(asr_snippet.split()) < 3:
        return None

    # 1. DuckDuckGo Search
    query = f"lyrics {asr_snippet}"
    url = "https://lite.duckduckgo.com/lite?" + urllib.parse.urlencode({"q": query})
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            html = r.read().decode("utf-8")
    except Exception as e:
        print(f"[identify_search] DDG request failed: {e}", file=sys.stderr)
        return None

    # Extract titles of results
    results = re.findall(r"<a[^>]*class=\"result-link\"[^>]*>(.*?)</a>", html, re.DOTALL)
    if not results:
        results = re.findall(r"<a[^>]*rel=\"nofollow\"[^>]*>(.*?)</a>", html, re.DOTALL)
        
    if not results:
        print("[identify_search] No search results found from DDG.", file=sys.stderr)
        return None

    clean_results = [clean_text(r) for r in results[:5]]
    search_str = "\n".join(r for r in clean_results if r)

    # 2. Extract with LLM
    body = json.dumps({
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Results:\n{search_str}"}
        ],
        "temperature": 0.0,
        "max_tokens": 128,
        "chat_template_kwargs": {"enable_thinking": False},
    }).encode()

    req_llm = urllib.request.Request(
        f"{LLM_BASE_URL}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req_llm, timeout=30) as r:
            llm_resp = json.loads(r.read())
    except Exception as e:
        print(f"[identify_search] LLM request failed: {e}", file=sys.stderr)
        return None

    content = llm_resp.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    try:
        found = parse_json_content(content)
        if found:
            print(f"[identify_search] Extracted: {found['artist']!r} - {found['title']!r}", file=sys.stderr)
            return found
    except (json.JSONDecodeError, TypeError, ValueError) as e:
        print(f"[identify_search] LLM parse error: {e}, raw={content!r}", file=sys.stderr)

    for result in clean_results:
        found = parse_result_title(result)
        if found:
            print(f"[identify_search] Fallback extracted: {found['artist']!r} - {found['title']!r}", file=sys.stderr)
            return found
    
    return None
