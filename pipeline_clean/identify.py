from __future__ import annotations

import re
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed


TITLE_NOISE = re.compile(
    r"\s*[\(\[][^)\]]*?(?:official|video|live|remix|cover|версия|концерт|"
    r"on\s+\w+\s+tv|live\s+session|hd|hq|lyric|клип|на\s+\w+\s+tv|"
    r"feat\.?|ft\.?|featuring|prod\.?|by|соль|рен\s+тв)\s*[^)\]]*[\)\]]\s*",
    re.IGNORECASE | re.UNICODE,
)
TITLE_SPLIT = re.compile(r"\s*[\|\-—–]\s*")


def add_candidate(candidates: OrderedDict[tuple[str, str], dict], artist: str | None, title: str | None, source: str) -> None:
    a = (artist or "").strip()
    t = (title or "").strip()
    if not t:
        return
    key = (a.casefold(), t.casefold())
    candidates.setdefault(key, {"artist": a, "title": t, "source": source})


def title_candidates(title: str | None, artist: str | None = None) -> list[dict]:
    candidates: OrderedDict[tuple[str, str], dict] = OrderedDict()
    if not title:
        return []
    raw = " ".join(title.split())
    clean = " ".join(TITLE_NOISE.sub(" ", raw).split())
    for value in [raw, clean]:
        add_candidate(candidates, artist, value, "metadata")
        parts = [p.strip() for p in TITLE_SPLIT.split(value) if p.strip()]
        if len(parts) >= 2:
            add_candidate(candidates, parts[0], parts[-1], "metadata-split")
            add_candidate(candidates, artist, parts[-1], "metadata-title-part")
    return list(candidates.values())


def asr_snippets(words: list[dict], *, count: int = 3, width: int = 15) -> list[str]:
    tokens = [str(w.get("word", "")).strip() for w in words if str(w.get("word", "")).strip()]
    if len(tokens) < 3:
        return []
    starts = [max(0, len(tokens) // 4), max(0, len(tokens) // 2 - width // 2), max(0, (len(tokens) * 3) // 4 - width)]
    out = []
    seen = set()
    for s in starts[:count]:
        snippet = " ".join(tokens[s:s + width])
        if snippet and snippet not in seen:
            out.append(snippet)
            seen.add(snippet)
    return out


def identify_candidates(asr_words: list[dict], meta: dict, user_artist: str | None, user_title: str | None) -> list[dict]:
    candidates: OrderedDict[tuple[str, str], dict] = OrderedDict()
    add_candidate(candidates, user_artist, user_title, "user")
    for c in title_candidates(meta.get("title") or meta.get("yt_title"), meta.get("uploader") or meta.get("channel")):
        add_candidate(candidates, c.get("artist"), c.get("title"), c.get("source", "metadata"))

    try:
        from pipeline import identify_search
        snippets = asr_snippets(asr_words)
        with ThreadPoolExecutor(max_workers=min(3, len(snippets)) or 1) as pool:
            futures = [pool.submit(identify_search.search_and_identify, snippet) for snippet in snippets]
            for future in as_completed(futures):
                found = future.result()
                if found:
                    add_candidate(candidates, found.get("artist"), found.get("title"), "asr-search")
    except Exception:
        pass
    return list(candidates.values())
