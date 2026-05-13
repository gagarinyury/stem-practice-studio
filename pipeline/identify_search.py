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

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://172.17.0.1:8083/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "qwen3.5-2b")

SYSTEM_PROMPT = (
    "Extract artist and song title from these search results. "
    "Clean up the title by removing any live performance metadata, locations, dates, "
    "and unnecessary text in brackets (e.g., '(СПБ 03.04.2016)', '(Live)', '(Official Video)', etc.). "
    'Return ONLY JSON: {"artist":"...","title":"..."}. '
    "Do not include any explanation or markdown formatting outside the JSON."
)

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

    search_str = "\n".join(re.sub(r"<[^>]+>", "", r).strip() for r in results[:5])

    # 2. Extract with LLM
    body = json.dumps({
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Results:\n{search_str}"}
        ],
        "temperature": 0.0,
        "max_tokens": 80,
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

    # Parse response
    content = llm_resp.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    
    # Strip markdown code blocks if LLM still hallucinates them
    if content.startswith("```json"):
        content = content[7:]
    if content.startswith("```"):
        content = content[3:]
    if content.endswith("```"):
        content = content[:-3]
    content = content.strip()

    try:
        data = json.loads(content)
        artist = (data.get("artist") or "").strip()
        title = (data.get("title") or "").strip()
        
        # Small LLMs often fail to clean brackets, so do it mechanically.
        title = re.sub(r"\(.*?\)", "", title)
        title = re.sub(r"\[.*?\]", "", title)
        title = title.replace(artist + " - ", "").replace(artist + " — ", "")
        title = title.strip(" -—")
        
        if artist and title:
            print(f"[identify_search] Extracted: {artist!r} - {title!r}", file=sys.stderr)
            return {"artist": artist, "title": title}
    except json.JSONDecodeError as e:
        print(f"[identify_search] LLM parse error: {e}, raw={content!r}", file=sys.stderr)
    
    return None
