"""Unit tests for pipeline.identify — pure helpers, no network."""
from collections import OrderedDict

import pytest

from pipeline.identify import (
    add_candidate,
    asr_snippets,
    best_metadata_candidate,
    clean_title,
    rank_candidates,
    title_candidates,
)


class TestCleanTitle:
    def test_strips_official_video_suffix(self):
        assert clean_title("Песня (Official Music Video)") == "Песня"

    def test_strips_brackets(self):
        assert clean_title("Title [HD]") == "Title"

    def test_collapses_whitespace(self):
        assert clean_title("  Title   Body  ") == "Title Body"

    def test_empty_input(self):
        assert clean_title(None) == ""
        assert clean_title("") == ""


class TestTitleCandidates:
    def test_artist_title_split(self):
        cands = title_candidates("Женя Трофимов - Самолёты - official video", artist=None)
        sources = {c["source"] for c in cands}
        assert "metadata-split" in sources
        split = next(c for c in cands if c["source"] == "metadata-split")
        assert split["artist"] == "Женя Трофимов"
        assert "Самолёты" in split["title"]

    def test_drops_noise_only_segments(self):
        cands = title_candidates("Title - Official Music Video", artist="Artist")
        for c in cands:
            assert "official" not in (c["title"] or "").lower()

    def test_empty_returns_empty_list(self):
        assert title_candidates(None) == []
        assert title_candidates("") == []


class TestAddCandidate:
    def test_dedupe_by_lowercased_key(self):
        d: OrderedDict = OrderedDict()
        add_candidate(d, "Artist", "Title", "metadata")
        add_candidate(d, "ARTIST", "title", "metadata-split")
        assert len(d) == 1
        # first wins
        assert next(iter(d.values()))["source"] == "metadata"

    def test_rejects_bad_candidate(self):
        d: OrderedDict = OrderedDict()
        add_candidate(d, "", "Song Finder", "asr-search")
        assert len(d) == 0

    def test_rejects_empty_title(self):
        d: OrderedDict = OrderedDict()
        add_candidate(d, "Artist", "", "metadata")
        add_candidate(d, "Artist", None, "metadata")
        assert len(d) == 0


class TestBestMetadataCandidate:
    def test_user_override_wins_over_metadata(self):
        meta = {"title": "Bad - YouTube Title", "artist": "BadArtist"}
        result = best_metadata_candidate(meta, user_artist="Real", user_title="Song")
        assert result["artist"] == "Real"
        assert result["title"] == "Song"

    def test_prefers_split_artist_title(self):
        meta = {"title": "Женя Трофимов - Самолёты - official video"}
        result = best_metadata_candidate(meta)
        assert result["artist"] == "Женя Трофимов"
        assert "Самолёты" in result["title"]

    def test_falls_back_to_raw(self):
        meta = {"title": "OnlyTitle"}
        result = best_metadata_candidate(meta)
        # no split possible, falls back; either way artist/title should not crash
        assert "title" in result and "artist" in result


class TestAsrSnippets:
    def test_returns_up_to_count(self):
        words = [{"word": f"w{i}"} for i in range(60)]
        snippets = asr_snippets(words, count=3, width=10)
        assert 1 <= len(snippets) <= 3
        for s in snippets:
            assert len(s.split()) <= 10

    def test_short_audio_no_snippets(self):
        assert asr_snippets([{"word": "a"}, {"word": "b"}]) == []

    def test_dedupes_overlapping(self):
        words = [{"word": "same"} for _ in range(30)]
        snippets = asr_snippets(words, count=3, width=5)
        assert len(snippets) == len(set(snippets))


class TestRankCandidates:
    def test_user_source_beats_metadata(self):
        cands: OrderedDict = OrderedDict()
        add_candidate(cands, "MetaA", "MetaT", "metadata")
        add_candidate(cands, "UserA", "UserT", "user")
        ranked = rank_candidates(cands, [])
        assert ranked[0]["source"] == "user"

    def test_drops_zero_or_negative_scores(self):
        cands: OrderedDict = OrderedDict()
        # title with SEGMENT_NOISE + no artist → heavy penalty
        cands[("", "official video")] = {"artist": "", "title": "official video", "source": "unknown"}
        ranked = rank_candidates(cands, [])
        assert ranked == []

    def test_cyrillic_asr_prefers_cyrillic_candidates(self):
        cands: OrderedDict = OrderedDict()
        add_candidate(cands, "EnArtist", "EnTitle", "metadata-split")
        add_candidate(cands, "Артист", "Песня", "metadata-split")
        cyrillic_asr = [{"word": "привет"}, {"word": "мир"}, {"word": "это"}, {"word": "тест"}]
        ranked = rank_candidates(cands, cyrillic_asr)
        assert ranked[0]["artist"] == "Артист"
