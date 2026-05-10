"""LRCLib lookup with version disambiguation."""
import json
import re
import urllib.error
import urllib.parse
import urllib.request

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


def _clean_title(title: str) -> str:
    """Strip YouTube-y noise from a title for LRClib lookup.

    Removes parenthesised modifiers ("(Live)", "(Official Video)", "(песня
    СашБаш)") and trims everything past a bullet/em-dash separator
    (channel names appended after "—" or "|"). Returns the trimmed,
    whitespace-collapsed string.
    """
    s = _TITLE_NOISE.sub(" ", title)
    # Cut after a separator if the part before it looks like a real title
    parts = _TITLE_PIPE.split(s, maxsplit=1)
    if parts and parts[0].strip():
        s = parts[0]
    return " ".join(s.split())


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

    cleaned = _clean_title(title) if title else ""
    title_variants = [t for t in (title, cleaned) if t and t.strip()]
    # Dedupe while preserving order
    seen_titles: set[str] = set()
    title_variants = [t for t in title_variants if not (t in seen_titles or seen_titles.add(t))]

    for tv in title_variants:
        if artist:
            _add_hits({"artist_name": artist, "track_name": tv})
        _add_hits({"track_name": tv})

    hits = list(seen.values())
    if not hits:
        return None

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
    asr_combined: dict[int, float] = {}
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
    # Reject low-quality matches when we have ASR — a "best" candidate
    # whose lyrics line up under 30% with the recording is almost
    # certainly the wrong song (e.g. happens when title is a junk
    # filename like "source"). Caller falls back to ASR-only.
    if asr_combined and asr_combined.get(best_idx, 0.0) < 0.30:
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
