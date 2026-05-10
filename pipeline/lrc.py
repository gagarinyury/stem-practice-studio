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


def fetch(artist: str, title: str, duration: float | None = None) -> dict | None:
    """Return best LRCLib record or None."""
    params = {"artist_name": artist, "track_name": title}
    if duration is not None:
        params["duration"] = str(int(round(duration)))
    try:
        return _http_json("https://lrclib.net/api/get?" + urllib.parse.urlencode(params))
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise

    hits = _http_json("https://lrclib.net/api/search?" + urllib.parse.urlencode(
        {"artist_name": artist, "track_name": title}))
    if not hits:
        return None

    def score(h):
        synced = bool(h.get("syncedLyrics"))
        d = h.get("duration") or 0.0
        delta = abs(d - duration) if duration else 0.0
        return (-int(synced), delta)

    hits.sort(key=score)
    return hits[0]


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
