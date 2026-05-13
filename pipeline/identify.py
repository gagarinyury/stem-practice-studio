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
TITLE_SPLIT = re.compile(r"\s*[\|\-—–~]\s*")
SEGMENT_NOISE = re.compile(
    r"\b(?:official|video|music\s+video|клип|live|concert|концерт|lyrics?|"
    r"текст|слова|cover|кавер|hd|hq|remaster(?:ed)?|visualizer)\b",
    re.IGNORECASE | re.UNICODE,
)
BAD_CANDIDATE = re.compile(
    r"\b(?:song\s+finder|find\s+(?:music|my\s+lyrics)|search\s+song|"
    r"quick,\s*easy,\s*fun|lyricsworld|тексты\s+песен\s+онлайн)\b",
    re.IGNORECASE | re.UNICODE,
)


def add_candidate(candidates: OrderedDict[tuple[str, str], dict], artist: str | None, title: str | None, source: str) -> None:
    a = (artist or "").strip()
    t = (title or "").strip()
    if not t or BAD_CANDIDATE.search(f"{a} {t}"):
        return
    key = (a.casefold(), t.casefold())
    candidates.setdefault(key, {"artist": a, "title": t, "source": source})


def clean_title(value: str | None) -> str:
    if not value:
        return ""
    value = " ".join(str(value).split())
    value = TITLE_NOISE.sub(" ", value)
    value = re.sub(r"\([^)]*\)", " ", value)
    value = re.sub(r"\[[^\]]*\]", " ", value)
    value = re.sub(r"\b(?:official\s+music\s+video|official\s+video|music\s+video|клип)\b", " ", value, flags=re.I)
    return " ".join(value.strip(" -—–~:/").split())


def _meaningful_parts(value: str) -> list[str]:
    parts = [clean_title(p) for p in TITLE_SPLIT.split(value) if clean_title(p)]
    return [p for p in parts if not SEGMENT_NOISE.search(p)]


def title_candidates(title: str | None, artist: str | None = None) -> list[dict]:
    candidates: OrderedDict[tuple[str, str], dict] = OrderedDict()
    if not title:
        return []
    raw = " ".join(str(title).split())
    clean = clean_title(raw)
    for value in [raw, clean]:
        add_candidate(candidates, artist, clean_title(value), "metadata")
        parts = _meaningful_parts(value)
        if len(parts) >= 2:
            # YouTube titles often have extra suffixes after the real song:
            # "Artist - Title - official music video". Use the first two
            # meaningful parts, not the last part.
            add_candidate(candidates, parts[0], parts[1], "metadata-split")
            if artist:
                add_candidate(candidates, artist, parts[1], "metadata-title-part")
    return list(candidates.values())


def best_metadata_candidate(meta: dict, user_artist: str | None = None, user_title: str | None = None) -> dict:
    trusted_artist = user_artist or meta.get("artist") or meta.get("yt_artist")
    title = user_title or meta.get("title") or meta.get("yt_title")
    candidates = title_candidates(title, trusted_artist)
    for source in ("metadata-split", "user", "metadata-title-part", "metadata"):
        for c in candidates:
            if c.get("source") == source and c.get("artist") and c.get("title"):
                return c
    return {"artist": trusted_artist or "", "title": title or ""}


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


def _script_profile(text: str) -> tuple[int, int]:
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


def _candidate_score(c: dict, asr_text: str) -> float:
    source = c.get("source") or ""
    artist = c.get("artist") or ""
    title = c.get("title") or ""
    score = {
        "user": 100,
        "metadata-split": 85,
        "metadata-title-part": 70,
        "metadata": 50 if artist else 25,
        "asr-search": 65,
    }.get(source, 35)
    if not artist:
        score -= 25
    if SEGMENT_NOISE.search(title):
        score -= 35
    if BAD_CANDIDATE.search(f"{artist} {title}"):
        score -= 80
    if len(title.split()) > 8:
        score -= 15
    asr_cyr, asr_lat = _script_profile(asr_text)
    cand_cyr, cand_lat = _script_profile(f"{artist} {title}")
    if asr_cyr > asr_lat and cand_cyr > 0:
        score += 8
    if asr_cyr > asr_lat and cand_lat > cand_cyr and cand_cyr == 0:
        score -= 8
    return score


def rank_candidates(candidates: OrderedDict[tuple[str, str], dict], asr_words: list[dict], *, limit: int = 8) -> list[dict]:
    asr_text = " ".join(str(w.get("word", "")) for w in asr_words)
    ranked = []
    for idx, c in enumerate(candidates.values()):
        item = dict(c)
        item["score"] = round(_candidate_score(item, asr_text), 2)
        ranked.append((item["score"], -idx, item))
    ranked.sort(reverse=True)
    return [item for score, _, item in ranked if score > 0][:limit]


def identify_candidates(asr_words: list[dict], meta: dict, user_artist: str | None, user_title: str | None) -> list[dict]:
    candidates: OrderedDict[tuple[str, str], dict] = OrderedDict()
    add_candidate(candidates, user_artist, user_title, "user")
    trusted_artist = user_artist or meta.get("artist") or meta.get("yt_artist")
    for c in title_candidates(meta.get("title") or meta.get("yt_title"), trusted_artist):
        add_candidate(candidates, c.get("artist"), c.get("title"), c.get("source", "metadata"))

    try:
        from . import identify_search
        snippets = asr_snippets(asr_words)
        with ThreadPoolExecutor(max_workers=min(3, len(snippets)) or 1) as pool:
            futures = [pool.submit(identify_search.search_and_identify, snippet) for snippet in snippets]
            for future in as_completed(futures):
                found = future.result()
                if found:
                    add_candidate(candidates, found.get("artist"), found.get("title"), "asr-search")
    except Exception:
        pass
    return rank_candidates(candidates, asr_words)
