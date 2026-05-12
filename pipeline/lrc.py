"""LRCLib lookup with version disambiguation."""
import json
import re
import urllib.error
import urllib.parse
import urllib.request


def _script_profile(text: str) -> tuple[float, float]:
    """Return (cyrillic_ratio, latin_ratio) over letter-only chars.

    Used to reject LRC candidates whose script disagrees with what was
    actually sung — e.g. NW alignment will happily report 100% match_rate
    between a 190-word English LRC and a 218-word Russian ASR transcript
    because bag-of-tokens overlap exists for any short LRC, but the songs
    are obviously not the same. Comparing character scripts is the
    cheapest reliable language proxy.
    """
    cyr = lat = total = 0
    for ch in text:
        if ch.isalpha():
            total += 1
            o = ord(ch)
            if 0x0400 <= o <= 0x04FF:
                cyr += 1
            elif (0x41 <= o <= 0x5A) or (0x61 <= o <= 0x7A):
                lat += 1
    if not total:
        return 0.0, 0.0
    return cyr / total, lat / total

UA = "stem-practice-studio/0.1 (https://github.com/gagarinyury/stem-practice-studio)"
LRC_TIMESTAMP = re.compile(r"\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]")
LRC_META = re.compile(r"\[(?:ti|ar|al|au|by|offset|re|ve|length):[^\]]*\]", re.IGNORECASE)


def _http_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


_TITLE_NOISE = re.compile(
    r"\s*[\(\[][^)\]]*?(?:official|video|live|remix|cover|версия|концерт|"
    r"on\s+\w+\s+tv|live\s+session|hd|hq|lyric|клип|на\s+\w+\s+tv|"
    r"feat\.?|ft\.?|featuring|prod\.?|by)\s*[^)\]]*[\)\]]\s*",
    re.IGNORECASE | re.UNICODE,
)
_TITLE_PIPE = re.compile(r"\s*[\|\-—–]\s*")


def _clean_title(title: str) -> list[str]:
    """Extract title variants from a YouTube-style title for LRClib lookup.

    Handles "Artist - Title (Live)" format: returns both the full cleaned
    string AND the part after the dash (which is usually the actual song
    name). Also strips parenthesised noise like "(Official Video)".
    """
    s = _TITLE_NOISE.sub(" ", title)
    s = " ".join(s.split())
    variants: list[str] = []
    if s:
        variants.append(s)
    # Split on " - " / " — " etc. and collect meaningful parts
    parts = _TITLE_PIPE.split(s)
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) >= 2:
        # "Artist - Title" → add just "Title" as the best variant (first!)
        variants.insert(0, parts[-1])
        # Also add just the first part in case roles are reversed
        if parts[0] not in variants:
            variants.append(parts[0])
    return variants


def fetch(
    artist: str,
    title: str,
    duration: float | None = None,
    asr_words: list[dict] | None = None,
) -> dict | None:
    """Return best LRCLib record or None.

    Two-pass search:
      1. `(artist, title)` — narrow query, works when caller has a real
         author hint
      2. `(title only)` — wide query, catches covers where the supplied
         artist is actually a YouTube channel ("РЕН ТВ", "Калинов Мост"
         covering Башлачёв, etc.) and LRClib indexes by song author
    Hits are deduped by id and ranked by ASR-alignment match-rate when
    ASR words are available — covers and originals naturally sort to
    the top because their lyrics actually match what's being sung.
    Without ASR we fall back to (synced, |duration_delta|) ordering.
    """
    seen: dict[int, dict] = {}

    def _add_hits(qs: dict[str, str]):
        try:
            res = _http_json("https://lrclib.net/api/search?" + urllib.parse.urlencode(qs))
        except Exception:
            return
        for h in res or []:
            hid = h.get("id")
            if hid is None or hid in seen:
                continue
            seen[hid] = h

    # Build title variants: original, cleaned parts, etc.
    title_variants = _clean_title(title) if title else []
    if title and title.strip() and title.strip() not in title_variants:
        title_variants.insert(0, title.strip())
    # Dedupe while preserving order
    seen_titles: set[str] = set()
    title_variants = [t for t in title_variants if not (t in seen_titles or seen_titles.add(t))]

    queries = []

    for tv in title_variants:
        if artist:
            queries.append({"artist_name": artist, "track_name": tv})
        queries.append({"track_name": tv})

    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as executor:
        list(executor.map(_add_hits, queries))

    hits = list(seen.values())
    if not hits:
        return None

    # Script guard — drop hits whose lyrics use a fundamentally different
    # script from what ASR transcribed. NW alignment can't tell language
    # apart (it matches tokens), so this is the only place we catch e.g.
    # an English LRC sneaking into a Russian recording's results.
    if asr_words:
        asr_text = " ".join(w.get("word", "") for w in asr_words)
        asr_cyr, asr_lat = _script_profile(asr_text)
        if asr_cyr > 0.5 or asr_lat > 0.5:
            asr_is_cyr = asr_cyr > asr_lat
            filtered = []
            for h in hits:
                lrc_text = h.get("syncedLyrics") or h.get("plainLyrics") or ""
                lrc_cyr, lrc_lat = _script_profile(lrc_text)
                lrc_is_cyr = lrc_cyr > lrc_lat
                if (lrc_cyr + lrc_lat) > 0.1 and lrc_is_cyr != asr_is_cyr:
                    continue
                filtered.append(h)
            if filtered:
                hits = filtered

    # Cheap pre-filter before expensive NW alignment: rank candidates by
    # (synced desc, |duration delta| asc) and keep top 5. LRClib can return
    # 50+ hits for popular songs; running NW on every one was eating ~50s.
    def _cheap_score(h: dict) -> tuple:
        synced = bool(h.get("syncedLyrics"))
        d = h.get("duration") or 0.0
        delta = abs(d - duration) if duration else 0.0
        return (-int(synced), delta)

    hits.sort(key=_cheap_score)
    hits = hits[:5]

    # Score each candidate by how well it matches the actual recording.
    # Two axes:
    #   match_rate    = matched_words / lrc_words   (penalises LRC entries
    #                                                with extra unsung words)
    #   asr_coverage  = matched_words / asr_words   (penalises LRC entries
    #                                                that are far too short
    #                                                — e.g. our "source"
    #                                                track matched a 20-word
    #                                                song while the recording
    #                                                has 264 ASR words)
    # Use min(match_rate, asr_coverage) — both must be high for a real hit.
    # Cache stats per candidate: combined score + structural signals.
    asr_combined: dict[int, float] = {}
    asr_stats: dict[int, dict] = {}
    if asr_words:
        from . import align as align_mod
        for idx, h in enumerate(hits):
            try:
                lrc_lines = parse(h.get("syncedLyrics") or h.get("plainLyrics") or "")
                lrc_words = words_from_lines(lrc_lines)
                if not lrc_words:
                    continue
                _, stats = align_mod.align(asr_words, lrc_words, duration or 0)
                match_rate = stats["match_rate"]
                asr_coverage = stats["matched"] / max(len(asr_words), 1)
                asr_combined[idx] = min(match_rate, asr_coverage)
                asr_stats[idx] = stats
            except Exception:
                continue

    def score(idx_hit):
        idx, h = idx_hit
        synced = bool(h.get("syncedLyrics"))
        d = h.get("duration") or 0.0
        delta = abs(d - duration) if duration else 0.0
        return (
            -asr_combined.get(idx, 0.0),
            -int(synced),
            delta,
        )

    indexed = list(enumerate(hits))
    indexed.sort(key=score)
    best_idx, best_hit = indexed[0]
    # Reject low-quality matches when we have ASR. Three guards, any
    # one failing kills the candidate — caller falls back to Genius
    # identification or pure ASR.
    #
    #   1. combined_rate ≥ 0.55 — minimum bag-of-tokens overlap. Catches
    #      junk LRC with insufficient word coincidence.
    #      (previously 0.30 — too loose, allowed 59% garbage matches)
    #   2. run_quality ≥ 0.40 — fraction of matched words sitting in
    #      consecutive runs of length ≥ 3. A real song match has long
    #      phrase-level streaks; a noise match is scattered singletons.
    #      This is the guard that catches the Башлачёв×"Source Tags &
    #      Codes" case where bag-overlap was 86% but no actual phrase
    #      aligned.
    #   3. lrc_span ≥ 0.50 — matched words spread across at least half
    #      the LRC. False matches cluster in a narrow window.
    if asr_combined:
        best_stats = asr_stats.get(best_idx, {})
        if asr_combined.get(best_idx, 0.0) < 0.55:
            return None
        if best_stats.get("run_quality", 0.0) < 0.40:
            return None
        if best_stats.get("lrc_span", 0.0) < 0.50:
            return None
    return best_hit


def parse(lrc_text: str) -> list[str]:
    """Strip metadata + timestamps, return non-empty lines."""
    out = []
    for raw in lrc_text.splitlines():
        s = LRC_META.sub("", raw)
        s = LRC_TIMESTAMP.sub("", s).strip()
        if s:
            out.append(s)
    return out


def words_from_lines(lines: list[str]) -> list[dict]:
    out = []
    for line_idx, line in enumerate(lines):
        for w in line.split():
            out.append({"word": w, "line": line_idx})
    return out
