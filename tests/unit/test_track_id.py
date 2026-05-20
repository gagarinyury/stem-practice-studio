"""Tests for make_track_id — the slug generator that produced
`https-www-youtube-com-watch-v-pAbGZg...` yesterday (issue: full URL leaked
into the slug because display_title fell back to `url`).
"""
from __future__ import annotations

import re

import pytest

# Import without triggering app startup
from backend.app import make_track_id


URL_LIKE = re.compile(r"\b(https?|youtube|watch|www)\b", re.IGNORECASE)


class TestMakeTrackId:
    def test_clean_title_produces_clean_slug(self):
        tid = make_track_id("Самолёты")
        assert tid.startswith("samolety-")
        assert not URL_LIKE.search(tid)

    def test_title_with_artist_works(self):
        tid = make_track_id("Женя Трофимов - Самолёты")
        assert "zhenya-trofimov" in tid or "samolety" in tid
        assert not URL_LIKE.search(tid)

    def test_none_title_does_not_crash(self):
        tid = make_track_id(None)
        assert tid.startswith("track-")

    def test_empty_title_does_not_crash(self):
        tid = make_track_id("")
        assert tid.startswith("track-")

    def test_long_title_is_truncated(self):
        long = "очень длинное название трека " * 20
        tid = make_track_id(long)
        # nanoid suffix is 6 chars + dash → slug part bounded by slugify max_length=40
        slug_part = tid.rsplit("-", 1)[0]
        assert len(slug_part) <= 41

    def test_youtube_url_must_not_appear_in_slug(self):
        """Regression test: when display_title is a YouTube URL (because user
        gave no title), the slug must not contain 'https', 'youtube', 'watch',
        or 'www'. This is the bug we hit in prod yesterday.
        """
        url = "https://www.youtube.com/watch?v=pAbGZg1234X"
        tid = make_track_id(url)
        assert not URL_LIKE.search(tid), (
            f"URL leaked into slug: {tid!r}. "
            "make_track_id should detect URLs and use video id or generic prefix."
        )
