"""
Эксперимент: влияние замедления аудио на качество ASR.

Тестируем 2 песни × 2 источника (микс / вокал) × 3 скорости (100% / 75% / 50%).
Для каждого варианта считаем:
  - сколько слов распознал ASR
  - match_rate с известными LRC (Needleman-Wunsch alignment)
"""
from __future__ import annotations
import json, subprocess, time, pathlib, sys, os

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from pipeline.align import align

RUNS = pathlib.Path("/srv/apps/stem-practice-studio/runs")
TMP   = pathlib.Path("/tmp/asr_exp")
TMP.mkdir(exist_ok=True)

ASR_URL = os.environ.get("ASR_URL", "http://127.0.0.1:8091")

TRACKS = [
    {
        "id": "yt-opf0ybxqdm0-QuYVgk",
        "label": "Uptown Funk (EN)",
        "lang": "en",
        "mix": "source.wav",
        "vocal": "stems/source_(Vocals)_htdemucs_6s.flac",
    },
    {
        "id": "trek-1-iN6uVf",
        "label": "Время колокольчиков (RU)",
        "lang": "ru",
        "mix": "source.wav",
        "vocal": "stems/source_(Vocals)_htdemucs_6s.flac",
    },
]

SPEEDS = [1.0, 0.75, 0.50]   # 100%, 75%, 50%


def slow_audio(src: pathlib.Path, speed: float, dst: pathlib.Path) -> None:
    """Применить atempo к аудио. speed=0.75 → замедлить до 75%."""
    if speed == 1.0:
        dst.symlink_to(src.resolve()) if not dst.exists() else None
        if not dst.exists():
            import shutil; shutil.copy2(src, dst)
        return
    # atempo принимает значения 0.5-2.0; для <0.5 нужно каскадировать
    atempo = speed
    filters = []
    while atempo < 0.5:
        filters.append("atempo=0.5")
        atempo /= 0.5
    filters.append(f"atempo={atempo:.4f}")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-filter:a", ",".join(filters), str(dst)],
        check=True, capture_output=True,
    )


def run_asr(audio: pathlib.Path, out: pathlib.Path, lang: str) -> list[dict]:
    import urllib.request
    body = json.dumps({
        "audio": str(audio.resolve()),
        "out": str(out.resolve()),
        "language": lang,
        "engine": "parakeet",
    }).encode()
    req = urllib.request.Request(
        f"{ASR_URL}/transcribe", data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        r.read()
    return json.loads(out.read_text())["words"]


def match_rate(asr_words: list[dict], lrc_words: list[dict], duration: float) -> float:
    aligned, stats = align(asr_words, lrc_words, duration)
    return stats.get("match_rate", 0.0)


def load_lrc_words(run_dir: pathlib.Path) -> tuple[list[dict], float]:
    aligned = json.loads((run_dir / "lyrics_aligned.json").read_text())
    duration = aligned.get("duration") or 0.0
    # Rebuild lrc_words list from aligned (each word with just 'word' and 'line')
    lrc_words = [{"word": w["word"], "line": w["line"]} for w in aligned["words"]]
    return lrc_words, duration


print(f"{'Трек':<30} {'Источник':<8} {'Скорость':>8}  {'слов ASR':>9}  {'match%':>7}  {'время':>6}")
print("-" * 75)

for track in TRACKS:
    run_dir = RUNS / track["id"]
    lrc_words, duration = load_lrc_words(run_dir)

    for src_key, src_label in [("mix", "микс"), ("vocal", "вокал")]:
        src_file = run_dir / track[src_key]
        if not src_file.exists():
            print(f"  ⚠ {track['label']} / {src_label}: файл не найден")
            continue

        for speed in SPEEDS:
            speed_pct = int(speed * 100)
            slug = f"{track['id']}_{src_key}_{speed_pct}"
            slowed = TMP / f"{slug}.flac"
            asr_out = TMP / f"{slug}_asr.json"

            # Замедляем
            t0 = time.perf_counter()
            slow_audio(src_file, speed, slowed)
            slow_sec = time.perf_counter() - t0

            # ASR
            t1 = time.perf_counter()
            asr_words = run_asr(slowed, asr_out, track["lang"])
            asr_sec = time.perf_counter() - t1

            # Корректируем тайминги ASR обратно на оригинальное время
            if speed != 1.0:
                for w in asr_words:
                    w["start"] = round(w["start"] * speed, 3)
                    w["end"]   = round(w["end"]   * speed, 3)

            # Считаем match_rate
            mr = match_rate(asr_words, lrc_words, duration)

            total_sec = slow_sec + asr_sec
            print(f"{track['label']:<30} {src_label:<8} {speed_pct:>7}%  {len(asr_words):>9}  {mr*100:>6.1f}%  {total_sec:>5.1f}s")

print()
print("Готово.")
