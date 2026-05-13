"""Identify song artist/title using DuckDuckGo, with LLM as a guarded fallback.

1. Takes a snippet of raw ASR text.
2. Searches DuckDuckGo with a language-aware lyrics query.
3. Parses/ranks structured search-result titles deterministically.
4. Uses a small warmed LLM only when DDG title parsing is not confident.
"""
from __future__ import annotations

from dataclasses import dataclass
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
    "Prefer canonical result titles like 'Artist - Title'. "
    "Do not choose a lyric line, song-finder page, translation page, or generic search page as the title. "
    "Preserve Cyrillic artist/title when the results contain Cyrillic; do not transliterate to Latin. "
    "Clean up the title by removing any live performance metadata, locations, dates, "
    "and unnecessary text in brackets (e.g., '(СПБ 03.04.2016)', '(Live)', '(Official Video)', etc.). "
    'Return ONLY JSON: {"artist":"...","title":"..."}. '
    "Do not include any explanation or markdown formatting outside the JSON."
)

TITLE_NOISE = re.compile(
    r"\b(?:lyrics?|текст\s+и\s+слова(?:\s+песни)?|текст(?:\s+песни)?|"
    r"слова(?:\s+песни)?|official|video|клип|youtube|chords?|аккорды)\b",
    re.IGNORECASE | re.UNICODE,
)
BAD_RESULT = re.compile(
    r"\b(?:song\s+finder|find\s+(?:music|my\s+lyrics)|search\s+song|"
    r"quick,\s*easy,\s*fun|lyricsworld|тексты\s+песен\s+онлайн|"
    r"перевод(?:ы)?|translation|translate)\b",
    re.IGNORECASE | re.UNICODE,
)


@dataclass(frozen=True)
class SearchResult:
    rank: int
    title: str
    url: str
    domain: str


def clean_text(value: str) -> str:
    value = unescape(re.sub(r"<[^>]+>", "", value))
    value = re.sub(r"\([^)]*\)", " ", value)
    value = re.sub(r"\[[^\]]*\]", " ", value)
    value = TITLE_NOISE.sub(" ", value)
    value = re.split(r"\s+\|\s+", value, maxsplit=1)[0]
    return " ".join(value.strip(" -—–~:").split())


def script_profile(text: str) -> tuple[int, int]:
    cyr = lat = 0
    for ch in text:
        if not ch.isalpha():
            continue
        o = ord(ch)
        if 0x0400 <= o <= 0x04FF:
            cyr += 1
        elif (0x41 <= o <= 0x5A) or (0x61 <= o <= 0x7A):
            lat += 1
    return cyr, lat


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
    if BAD_RESULT.search(text):
        return None
    text = re.split(r"\s+-\s+(?:Genius|AZLyrics|YouTube|Last\.fm|Spotify)\b", text, maxsplit=1)[0]
    group_match = re.search(r"Группа\s+[«\"]?(.+?)[»\"]?\.\s+Песня\s+-\s+(.+)$", text, re.I)
    if group_match:
        artist, title = clean_text(group_match.group(1)), clean_text(group_match.group(2))
        if artist and title and not BAD_RESULT.search(f"{artist} {title}"):
            return {"artist": artist, "title": title}
    parts = [p.strip() for p in re.split(r"\s+[-—–~]\s+", text, maxsplit=1) if p.strip()]
    if len(parts) != 2:
        return None
    artist, title = clean_text(parts[0]), clean_text(parts[1])
    if BAD_RESULT.search(f"{artist} {title}"):
        return None
    if artist and title:
        return {"artist": artist, "title": title}
    return None


def decode_ddg_href(href: str) -> str:
    href = unescape(href)
    parsed = urllib.parse.urlparse(href)
    qs = urllib.parse.parse_qs(parsed.query)
    if qs.get("uddg"):
        return qs["uddg"][0]
    return urllib.parse.urljoin("https://lite.duckduckgo.com", href)


def domain_of(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).netloc.lower()
    except ValueError:
        return ""


def ddg_search(query: str, *, limit: int = 8) -> list[SearchResult]:
    url = "https://lite.duckduckgo.com/lite?" + urllib.parse.urlencode({"q": query})
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as r:
        page = r.read().decode("utf-8", "replace")

    matches = re.findall(
        r"<a[^>]*href=[\"']([^\"']+)[\"'][^>]*(?:class=[\"']result-link[\"']|rel=[\"']nofollow[\"'])[^>]*>(.*?)</a>",
        page,
        re.DOTALL,
    )
    out: list[SearchResult] = []
    for rank, (href, raw_title) in enumerate(matches, start=1):
        title = clean_text(raw_title)
        if not title:
            continue
        url = decode_ddg_href(href)
        out.append(SearchResult(rank=rank, title=title, url=url, domain=domain_of(url)))
        if len(out) >= limit:
            break
    return out


def search_queries(asr_snippet: str) -> list[str]:
    cyr, lat = script_profile(asr_snippet)
    if cyr > lat:
        return [f"текст песни {asr_snippet}", f"слова песни {asr_snippet}"]
    return [f"lyrics {asr_snippet}"]


def score_result(found: dict, result: SearchResult, asr_snippet: str) -> float:
    artist = found.get("artist") or ""
    title = found.get("title") or ""
    score = 80 - result.rank * 6
    if BAD_RESULT.search(f"{artist} {title} {result.title}"):
        score -= 100
    if re.search(r"\b(?:genius|azlyrics|lyrics|tekst|pesni|aria\.ru|musixmatch|tekstowo)\b", result.domain, re.I):
        score += 8
    if len(title.split()) > 8:
        score -= 20
    asr_cyr, asr_lat = script_profile(asr_snippet)
    cand_cyr, cand_lat = script_profile(f"{artist} {title}")
    if asr_cyr > asr_lat and cand_cyr > 0:
        score += 8
    if asr_cyr > asr_lat and cand_lat > cand_cyr and cand_cyr == 0:
        score -= 8
    return score


def best_ddg_candidate(results: list[SearchResult], asr_snippet: str) -> dict | None:
    scored = []
    for result in results:
        found = parse_result_title(result.title)
        if not found:
            continue
        scored.append((score_result(found, result, asr_snippet), found, result))
    if not scored:
        return None
    scored.sort(key=lambda x: x[0], reverse=True)
    score, found, result = scored[0]
    if score < 45:
        return None
    print(
        f"[identify_search] DDG picked: {found['artist']!r} - {found['title']!r} "
        f"score={score:.1f} rank={result.rank} domain={result.domain}",
        file=sys.stderr,
    )
    return found


def ask_llm(clean_results: list[str]) -> dict | None:
    if not clean_results:
        return None
    search_str = "\n".join(r for r in clean_results[:5] if r)

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
        if found and not BAD_RESULT.search(f"{found['artist']} {found['title']}"):
            print(f"[identify_search] Extracted: {found['artist']!r} - {found['title']!r}", file=sys.stderr)
            return found
    except (json.JSONDecodeError, TypeError, ValueError) as e:
        print(f"[identify_search] LLM parse error: {e}, raw={content!r}", file=sys.stderr)

    return None


def search_and_identify(asr_snippet: str) -> dict | None:
    """Search DDG with the snippet and extract artist/title."""
    if not asr_snippet or len(asr_snippet.split()) < 3:
        return None

    all_results: list[SearchResult] = []
    for query in search_queries(asr_snippet):
        try:
            results = ddg_search(query)
        except Exception as e:
            print(f"[identify_search] DDG request failed: {e}", file=sys.stderr)
            continue
        all_results.extend(results)
        found = best_ddg_candidate(results, asr_snippet)
        if found:
            return found

    if not all_results:
        print("[identify_search] No search results found from DDG.", file=sys.stderr)
        return None

    # Guarded fallback only. The normal path should be deterministic DDG
    # parsing; LLM guesses are allowed only when they are not obvious search
    # utility pages.
    return ask_llm([r.title for r in all_results[:5]])
