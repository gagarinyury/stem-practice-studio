# Stem Practice Studio

Веб-приложение для разучивания музыки: разделение треков на стемы, karaoke с word-level подсветкой, drill-режим с микрофоном и pitch-feedback. Для вокалистов, барабанщиков, басистов, гитаристов.

Рантайм: GMKtec Evo-X2 (AMD Radeon 8060S / gfx1151, ROCm) + Next.js фронт.

## Структура

- `bench/` — Phase 0: бенчмарк моделей разделения на gfx1151 (ROCm vs CPU, BS-RoFormer SW vs Mel-RoFormer vs HTDemucs)
- `pipeline/` — Phase 1: end-to-end CLI (демиксинг → ASR → структура → аккорды → drum-MIDI)
- `backend/` — Phase 2: FastAPI + arq queue + SSE прогресс
- `web/` — Phase 3+: Next.js плеер, drill-режим, pitch-feedback

## Дизайн

7 HTML-мокапов: `~/Downloads/1234/screen_*.html` (Cormorant Garamond + DM Mono, бумажная палитра).

## Стек (зафиксирован май 2026)

| Слой | Выбор |
|---|---|
| Демиксинг 6 стемов | BS-RoFormer SW (audio-separator) |
| ASR EN/FR/ES/DE/IT/PT | Parakeet-TDT-0.6B-v3 (ONNX+ROCm) |
| ASR RU | GigaAM (отдельный сервис на :8082) |
| Структура | SongFormer |
| Pitch (offline) | SwiftF0 |
| Pitch (browser real-time) | pitchy (MPM) |
| Backend | FastAPI + arq + Redis |
| Frontend | Next.js 15 + WaveSurfer v7 + rubberband-wasm |
| Mobile wrap (позже) | Capacitor v7 |

План разработки: `~/.claude/plans/concurrent-honking-pumpkin.md`.

## Статус (2026-05-10)

**Phase 0** ✅ Бенчмарк разделения: htdemucs_6s выбран primary (ROCm 64s/трек, 6 стемов).
**Phase 1.1** ✅ ASR: Parakeet-TDT-v3 (EN/EU) + GigaAM v3 (RU). Оба работают на ROCm gfx1151. RTF 0.054.
**Phase 1.2** ✅ LRCLib lookup + NW alignment ASR↔LRC. Match rate 82-88%. `bench/asr/preview/<track>/karaoke.html`.
**Phase 1.4** ✅ End-to-end CLI `python -m pipeline.process`. На YT-ссылке Калинов Мост: 103.6s total.
**Phase 1.5** ✅ A/B full-mix vs vocal-stem: sep обязателен для RU (silero-vad не работает на музыке), для EN +9pp WER от sep.
**Phase 1.6** ✅ Separation speed matrix: htdemucs_6s остаётся sweet spot. mel_kim даёт −6pp WER но только 2 стема.

Подробности: `bench/results.md`.

### Артефакты которые работают

```bash
# end-to-end на YT-треке (на evo)
python -m pipeline.process --url <YT> -o runs/<slug> \
    --language ru --artist "X" --title "Y"

# karaoke preview (на Mac)
open bench/asr/preview/8LL0TgWmvaE/karaoke.html

# A/B WER scoring
bash bench/asr/run_ab.sh && python3 bench/asr/score_wer.py <ab_dir>
```

### Critical gotchas (для будущей разработки)

- **Docker `-v` хочет absolute paths** (`Path.resolve()`).
- **NeMo 2.7.3 на ROCm**: явно `EncDecRNNTBPEModel.from_pretrained()` (не `ASRModel.`); + monkey-patch `maybe_enable_cuda_graphs` → no-op (libcuda dlopen).
- **GigaAM**: ставить с `git+https://github.com/salute-developers/GigaAM.git` (PyPI 0.1.0 без word_timestamps); `transcribe_longform` требует pyannote (gated) → используем silero-vad chunking.
- **htdemucs_ft медленнее `_6s` в 2.5×** из-за ensemble (4 weight-файла), не TTA.
- **LRCLib quirks**: для каверов искать оригинального автора; искать с ё, не е; `--duration` для disambiguation версий.
- **Vulkan-бэкенд PyTorch не существует** для ML инференса — всё ML только на ROCm или CPU.
- **На single GPU параллелить 2 ML-задачи бессмысленно** (queue к hardware).

### Дальше

См. план `~/.claude/plans/concurrent-honking-pumpkin.md`. Следующий шаг на выбор: D (Next.js плеер первый UI) / A (FastAPI Phase 2) / B (CTC alignment Phase 1.7).
