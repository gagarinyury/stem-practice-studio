"""Unit tests for pipeline.lyrics low-level helpers (no network)."""
import pytest

from pipeline.lyrics import lev, norm_word, script_mismatch, similar


class TestNormWord:
    def test_lowercases_and_strips_non_alnum(self):
        assert norm_word("Hello, World!") == "helloworld"

    def test_yo_to_e(self):
        assert norm_word("Ёлка") == "елка"
        assert norm_word("ёж") == "еж"


class TestLev:
    def test_identical_zero(self):
        assert lev("abc", "abc") == 0

    def test_empty_returns_length_of_other(self):
        assert lev("", "abc") == 3
        assert lev("abc", "") == 3

    def test_known_distance(self):
        assert lev("kitten", "sitting") == 3


class TestSimilar:
    def test_exact_match(self):
        assert similar("привет", "привет") is True

    def test_one_edit_short(self):
        # 1/6 ratio ≈ 0.16 ≤ 0.34 → similar
        assert similar("привет", "превет") is True

    def test_too_different(self):
        assert similar("cat", "elephant") is False

    def test_empty_word_not_similar(self):
        assert similar("", "x") is False
        assert similar("x", "") is False


class TestScriptMismatch:
    def test_cyrillic_vs_latin(self):
        asr = [{"word": "привет"}, {"word": "мир"}]
        assert script_mismatch(asr, "hello world london") is True

    def test_same_script_ok(self):
        asr = [{"word": "привет"}, {"word": "мир"}]
        assert script_mismatch(asr, "привет мир ты как") is False

    def test_ambiguous_no_mismatch(self):
        # very short texts → returns False (not enough signal)
        assert script_mismatch([{"word": "a"}], "b") is False
