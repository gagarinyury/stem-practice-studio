"""Score WER of ASR outputs against LRC reference text. A/B helper."""
import argparse
import json
import re
from pathlib import Path

WORD_NORM = re.compile(r"[^\w]+", re.UNICODE)


def norm(words: list[str]) -> list[str]:
    out = []
    for w in words:
        s = WORD_NORM.sub("", w.lower()).replace("ё", "е")
        if s:
            out.append(s)
    return out


def levenshtein_words(a: list[str], b: list[str]) -> int:
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur.append(min(cur[-1] + 1, prev[j] + 1, prev[j - 1] + cost))
        prev = cur
    return prev[-1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ab_dir", type=Path)
    args = ap.parse_args()

    cases = [
        ("RU full-mix",   args.ab_dir / "ru-full"   / "lyrics.json", args.ab_dir / "ru-lrc.json"),
        ("RU vocal-stem", args.ab_dir / "ru-vocals" / "lyrics.json", args.ab_dir / "ru-lrc.json"),
        ("EN full-mix",   args.ab_dir / "en-full"   / "lyrics.json", args.ab_dir / "en-lrc.json"),
        ("EN vocal-stem", args.ab_dir / "en-vocals" / "lyrics.json", args.ab_dir / "en-lrc.json"),
    ]

    print(f"{'case':<14} {'asr_words':>10} {'ref_words':>10} {'edits':>8} {'WER':>8}")
    print("-" * 56)
    for name, asr_path, ref_path in cases:
        if not asr_path.exists() or not ref_path.exists():
            print(f"{name:<14} MISSING ({asr_path})")
            continue
        asr = json.loads(asr_path.read_text())
        ref = json.loads(ref_path.read_text())
        asr_words = norm([w["word"] for w in asr.get("words", [])])
        ref_words = norm([w["word"] for w in ref.get("words", [])])
        if not ref_words:
            ref_words = norm(ref.get("text", "").split())
        edits = levenshtein_words(asr_words, ref_words)
        wer = edits / max(len(ref_words), 1)
        print(f"{name:<14} {len(asr_words):>10} {len(ref_words):>10} {edits:>8} {wer*100:>7.2f}%")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
