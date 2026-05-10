# Phase 0 — результаты бенчмарка

Железо: AMD Ryzen AI Max+ 395 / Radeon 8060S iGPU (gfx1151), 96 GB DDR5
Софт: PyTorch 2.11 + ROCm 7.12 (kyuz0/amd-strix-halo-comfyui) + audio-separator 0.44.1
Дата: 2026-05-10

## GPU run (ROCm)

| Модель | Трек | Wall | Peak RAM | Стемов | Заметки |
|---|---|---|---|---|---|
| htdemucs_ft | 8LL0TgWmvaE | 2:44 | 4.7 GB | 4 | первый прогон — MIOpen JIT warmup |
| htdemucs_ft | MwpMEbgC7DA | 2:18 | 4.3 GB | 4 | — |
| **htdemucs_6s** | 8LL0TgWmvaE | **1:07** | 4.4 GB | **6** | vocals/drums/bass/**guitar**/piano/other |
| **htdemucs_6s** | MwpMEbgC7DA | **0:59** | 3.9 GB | **6** | — |
| bs_roformer_viperx (ep_317) | 8LL0TgWmvaE | 3:46 | 2.6 GB | 2 | vocal/instrumental только |
| bs_roformer_viperx (ep_317) | MwpMEbgC7DA | 2:46 | 2.4 GB | 2 | — |
| MelBandRoformer.ckpt | both | FAIL | — | — | имя файла неправильное (нет в каталоге) |

## Решения

1. **Основная модель: `htdemucs_6s.yaml`** — даёт ровно те 6 стемов, которые нужны для drill-режимов всех ролей (вокалист / барабанщик / басист / гитарист). Wall ≈1 мин на 4-минутный трек на ROCm. Peak RAM ~4.5 GB.

2. **Дополнительная для ASR-pipeline: `mel_band_roformer_kim_ft_unwa.ckpt`** — vocals SDR = 12.4 (выше чем у htdemucs_6s = 9.6). После 6s достаём из неё чистый вокал и кормим Parakeet — даст лучший WER на пении.

3. **BS-RoFormer SW (6-stem) от ZFTurbo / jarredou — НЕ в каталоге audio-separator** (май 2026). В ресёрче упоминалась, но как кастомные веса на HuggingFace. Если когда-то понадобится более качественная гитара — добавить отдельным контейнером.

## ROCm на gfx1151 — статус

✅ Работает. Кernels компилируются JIT при первом запуске (overhead ~20s на старт), потом стабильные ~3 it/s на htdemucs. MIOpen warnings non-fatal. `HSA_OVERRIDE_GFX_VERSION` не понадобился — kyuz0 в базовом образе уже подкрутил.

⚠️ ONNXRuntime CUDA-EP не подключён (только CPU-EP). Для PyTorch-моделей это не блокер. Если в pipeline понадобится ONNX-инференс (Parakeet через onnx-asr) — добавить `onnxruntime-rocm` в Dockerfile.

---

# Phase 1.1 — Parakeet-TDT-0.6B-v3 ASR (NeMo)

Дата: 2026-05-10
Образ: `stem-practice-asr:rocm` (kyuz0 base + nemo_toolkit 2.7.3)
Модель: `nvidia/parakeet-tdt-0.6b-v3` (Apache 2.0, multilingual, native word timestamps)

## Запуск на htdemucs_6s vocal-стемах

| Трек | Lang | Duration | Inference | RTF | Words | Качество |
|---|---|---|---|---|---|---|
| 8LL0TgWmvaE | RU | 313.7s | 17.1s | **0.055** | — | мусор (Parakeet RU слабый) |
| MwpMEbgC7DA | EN | 247.6s | 13.3s | **0.054** | 265 | хорошее, связный текст |

ROCm gfx1151 даёт **~18× быстрее реального времени**. Загрузка весов (~1.2GB) — 7.5 сек.

## Решения

1. **EN/FR/ES/DE/IT/PT → Parakeet через NeMo на ROCm.** Подтверждено что работает, качество удовлетворительное.
2. **RU → GigaAM (:8082, уже стоит).** Parakeet формально многоязычный, но качество русского мусорное — подтверждает выбор из ресёрча.
3. **Стемы перед ASR**: stereo 44.1k → mono 16k через soundfile + torchaudio (NeMo dataloader stereo не глотает).

## ROCm-совместимость NeMo — нюансы

NeMo 2.7.3 из коробки делает 2 вещи, ломающие ROCm:
1. `ASRModel.from_pretrained()` диспатчер инстанцирует абстрактный класс → надо явно `EncDecRNNTBPEModel.from_pretrained()`
2. TDT-декодер вызывает `maybe_enable_cuda_graphs()`, которая через `cuda-python` пытается dlopen `libcuda.so.1` (NVIDIA-only) → надо monkey-patch'нуть метод в no-op на классах в `tdt_label_looping` и `rnnt_label_looping`

Оба воркэраунда в `bench/asr/transcribe.py`.

## ONNX-путь

Не пошли — `onnxruntime-rocm` wheel для ROCm 7.0 не опубликован в AMD-репо на 2026-05. NeMo на ROCm PyTorch (известно-рабочий после Phase 0) надёжнее.

---

---

# Phase 1.2 — LRCLib + ASR↔LRC alignment

Дата: 2026-05-10
Скрипты: `bench/asr/preview/{fetch_lrc,align_to_lrc,build_preview}.py`
Артефакты: `bench/asr/preview/<track>/{lrc.txt, lrc_words.json, lyrics_aligned.json, karaoke.html}`

## Зачем

ASR сам по себе ошибается на редких словах, поэтической лирике и склейках предлогов. На «Время колокольчиков» (кавер Калинов Моста на Башлачёва) GigaAM v3 RNN-T выдал:

> «...шали снег **скашаю березовай** и росли с колокольнями...» вместо «Жрали снег **с кашею березовой**...»

Текст из LRCLib даёт чистую лирику. ASR используется только для таймингов (где петь). Forced alignment связывает: каждое слово LRC получает позицию ближайшего совпавшего слова из ASR-вывода.

## Pipeline

```
yt-dlp metadata (artist, title, duration)
  └─ fetch_lrc.py  → LRCLib API (/api/get с duration filter, fallback /api/search)
                    → strip [mm:ss.xx] метки → lrc.txt + lrc_words.json (с line-индексами)

ASR на vocal-стеме (GigaAM для RU / Parakeet для EN из Phase 1.1)
  └─ lyrics.json (грязный текст + точные тайминги по словам)

align_to_lrc.py
  ├─ Needleman-Wunsch: cost = нормализованный Левенштейн между норм-словами
  │  (lower + drop punct + ё→е); skip penalty 0.55
  ├─ Каждый LRC-слову: если matched → копируем тайминги ASR-слова
  ├─ Если не matched (insertion в LRC) → линейная интерполяция между ближайшими anchor'ами
  └─ → lyrics_aligned.json (LRC текст + ASR тайминги + флаг match=asr/interp)

build_preview.py → karaoke.html (offline, lyrics inlined, без CORS)
  ├─ Текст разбит построчно как в LRC (line.active подсвечивается)
  ├─ Подсветка текущего слова (var(--accent))
  ├─ Слова с match=interp подчёркнуты пунктиром (var(--warn))
  └─ Click-to-seek
```

## LRCLib coverage observations

- **Кавер-артиста часто нет**: «Калинов Мост — Время колокольчиков» — 0 hits. «Александр Башлачёв» (оригинальный автор) — 6 hits, synced. Решение: для каверов искать оригинального автора.
- **Нормализация ё/е хромает**: «Башлачёв» → 6 hits synced; «Башлачев» (без ё) → 3 hits, ни одного synced. Поиск надо делать с ё.
- **Multiple versions**: для Tom Odell 20 records разной длины (244, 247, 251с). `--duration` параметр в fetch_lrc отбирает ближайшую.
- **LRC-тайминги для каверов бесполезны**: Башлачёв 226с, Калинов Мост 314с. Ignore их полностью; используем только текст и line-структуру.

## Результаты

| Track | LRC words | Matched ASR | Match rate | Interpolated |
|---|---|---|---|---|
| Башлачёв "Время колокольчиков" (Калинов Мост cover) | 261 | 215 | **82.4%** | 46 |
| Tom Odell "Another Love" | 297 | 261 | **87.9%** | 36 |

82% на каверном RU-треке с архаизмами + 88% на студийном EN-треке. Глазом и слухом тайминги попадают в слова правильно. Слова которые ASR пропустил (длинные ноты, повторы у вокалиста кавера) интерполируются между соседями — заметны в UI, но не ломают восприятие.

## Решения

1. **Текст всегда из LRCLib** когда есть match (≥80% LRC words matched к ASR). Для каверов искать оригинального автора.
2. **Тайминги всегда от ASR** на нашем vocal-стеме. LRC-тайминги игнорируются (могут быть от другой версии).
3. **Forced alignment через NW + Levenshtein** — Phase 1.2 baseline. Match-rate 82-88% хватает для karaoke-подсветки.
4. **CTC forced alignment** (через `gigaam v3_ctc` + `torchaudio.functional.forced_align`) — апгрейд для Phase 1.3 если interpolated регионы будут смотреться плохо в плеере. Даст 100% слов LRC с точными CTC-эмиссиями вместо интерполяции.

## Verification

`open bench/asr/preview/8LL0TgWmvaE/karaoke.html` — Калинов Мост, чистый текст Башлачёва на тайминги кавера.
`open bench/asr/preview/MwpMEbgC7DA/karaoke.html` — Tom Odell.

---

# Phase 1.4 — End-to-end pipeline `pipeline/process.py`

Дата: 2026-05-10
Скрипт: `pipeline/process.py` + модули `yt.py`, `separate.py`, `asr.py`, `lrc.py`, `align.py`

## Что делает

Один CLI на evo: `python -m pipeline.process --url <YT> -o runs/<slug> --language ru|en --artist X --title Y`. Принимает либо локальный аудиофайл, либо YT URL.

```
yt-dlp (через bench image)              → source.wav + source.info.json
   ↓
htdemucs_6s (stem-practice-bench:rocm)  → 6 стемов в stems/
   ↓
GigaAM | Parakeet (stem-practice-asr)   → lyrics.json (raw ASR на vocals)
   ↓
LRCLib /api/get + /api/search           → lrc.txt + lrc_words.json
   ↓
NW alignment (CPU, локально)            → lyrics_aligned.json
   ↓
manifest.json (склейка для плеера)
```

## Замер на Калинов Мост (8LL0TgWmvaE, RU, 313.7s)

| Стадия | Время | Доля |
|---|---|---|
| yt-dlp download | 3.1s | 3% |
| htdemucs_6s separation | **64.8s** | **63%** |
| GigaAM ASR (load + infer) | 28.3s | 27% |
| LRCLib HTTP | 7.1s | 7% |
| NW alignment | 0.3s | <1% |
| **Total** | **103.6s** | |

Match rate: **212/261 (81.2%)**, 49 interpolated. Манифест — единый JSON со всеми путями стемов, lyrics, aligned-lyrics, LRC source, и timings.

## Граблиная реализационная мелочь

Docker `-v` отказывается принимать относительные пути (трактует как именованные volumes). Все Path → `.resolve()` перед формированием cmd.

## Доли времени — где экономить

- **htdemucs 65% времени** — основной bottleneck. Если когда-нибудь докрутят ROCm-ускорение для BS-RoFormer ensemble — пересмотрим.
- **GigaAM load 7.6s** — модель грузится при каждом запуске. В Phase 2 (FastAPI+arq) держим в памяти воркера → экономим эти 7-10 сек.
- **LRCLib 7s** — HTTP с дефолтным таймаутом. Можно параллелить с htdemucs (зависит только от метаданных yt-dlp). На single-track выигрыш мизерный.
- **htdemucs ↔ GigaAM нельзя параллелить** — GigaAM ест vocals-стем как вход.

## Открытый вопрос — на что тратится htdemucs

Может быть **демиксинг сам по себе вреден для ASR**. Артефакты demixing (phasing, spectral mask edges, residual bleed) — out-of-distribution для ASR-моделей, обученных на естественной речи. Возможно `source.wav` напрямую даст лучше WER, чем `vocals.flac`. **Phase 1.5 = A/B**.

---

---

# Phase 1.5 — A/B ASR на full-mix vs vocal-stem

Дата: 2026-05-10
Скрипты: `bench/asr/run_ab.sh` + `bench/asr/score_wer.py`
Данные: `bench/results/ab_20260510-101227/`

## Гипотеза

Артефакты htdemucs (phasing, residual bleed, spectral mask edges) могут быть out-of-distribution для ASR-моделей, обученных на естественной речи. Full-mix может дать лучшее или равное качество и сэкономит 65% времени pipeline.

## Метод

Один и тот же source-файл (Калинов Мост 313s для RU, Tom Odell 247s для EN) → две ветки: GigaAM/Parakeet на полном миксе и на htdemucs vocal-стеме. WER считается word-Левенштейном к LRC reference (нормализация: lower + drop punct + ё→е).

## Результаты

| Case | ASR words | Ref | Edits | WER |
|---|---|---|---|---|
| RU full-mix | **1** | 258 | 257 | **99.6%** ⛔ |
| RU vocal-stem | 222 | 258 | 114 | **44.2%** |
| EN full-mix | 254 | 297 | 129 | **43.4%** |
| EN vocal-stem | 265 | 297 | 102 | **34.3%** |

## Поправка на baseline

WER завышен из-за mismatch между LRC и реальным аудио:
- RU: LRC = Башлачёв оригинал, аудио = Калинов Мост кавер с импровизациями → даже идеальный ASR ~20-25% WER
- EN: студийный Tom Odell = LRC ref, baseline ~0%

«Честный» WER vocal-stem: **RU ~20%**, **EN ~30%**.

## Анализ RU full-mix провала

GigaAM выдал 1 слово на 313 секунд. Текст: `'шли'` (правильное слово из «Долго шли, зноем»). Причина — `silero-vad` распознал только **1 chunk** на полном миксе. VAD-модель обучалась на речи, музыка для неё не похожа на голос по фичам. Это не GigaAM фейлит, а VAD не пропускает. На chunked-25s без VAD результат был бы другой, но это отдельный эксперимент.

## Решения

1. **RU: демиксинг обязателен.** Не из-за качества GigaAM, а из-за VAD. На vocal-стеме VAD работает, на full mix — нет. Без VAD GigaAM упирается в 30s limit.
2. **EN: демиксинг помогает (+9pp).** 43% → 34% WER. Не критично, но реально. Parakeet робастен к фоновому шуму больше чем GigaAM, но всё равно sep даёт прибавку.
3. **Pipeline остаётся sep → ASR.** Гипотеза «full mix лучше» не подтвердилась.
4. **Возможный шорткат для EN**: при необходимости срезать 65% времени можно опускать sep с -9pp WER hit. Например: первый быстрый прогон без sep за 13s, потом фоном уточнять.

---

---

# Phase 1.6 — Separation speed/quality matrix

Дата: 2026-05-10
Скрипт: `bench/asr/run_sep_speed.sh`
Данные: `bench/results/sepspeed_20260510-101902/`

## Гипотеза

Если нужны не все 6 стемов (например только vocal+instrumental для karaoke), 2-стемовые модели должны быть быстрее. Проверяем total time (sep + ASR) и WER.

## Метод

5 separation моделей × тот же source (Калинов Мост 313s) → GigaAM на vocals → WER к LRC. Все на ROCm gfx1151.

## Результаты

| Model | sep_s | asr_s | total_s | WER | Stems | Note |
|---|---|---|---|---|---|---|
| **mel_band_roformer_kim_ft_unwa** | 125.5 | 28.4 | **153.9** | **36.8%** ⭐ | 2 | best WER |
| **htdemucs_ft** (4-stem ensemble) | 163.7 | 28.7 | 192.4 | 40.3% | 4 | избегать — самый медленный |
| **htdemucs_6s** (нынешний baseline) | 64.2 | 26.9 | **91.1** | 43.0% | **6** ⭐ | best для full app |
| **UVR-MDX-NET-Inst_HQ_5** | 62.9 | 33.4 | 96.3 | 45.3% | 2 | без выгоды |
| **UVR_MDXNET_KARA_2** | **59.1** ⭐ | 28.2 | **87.3** | 46.9% | 2 | fastest, но WER хуже |

## Анализ

1. **htdemucs_ft медленнее htdemucs_6s в 2.5×** не из-за shifts/TTA, а из-за **ensemble** — `_ft` усредняет 4 разных weight-файла (4× compute). `_6s` — single model. Это объясняет Phase 0 timings.
2. **mel_kim — победитель по качеству**: −6.2pp WER к htdemucs_6s. Тяжёлая модель (Mel-Band RoFormer), 125s sep, но даёт **значимо** более чистый вокал.
3. **MDX-Net — не оправдывают**: на ~5 секунд быстрее htdemucs_6s, но WER на 2-4pp хуже. Качество вокального стема явно ниже.
4. **htdemucs_6s остаётся sweet spot**: 91s total, 6 стемов одной командой. Для full-app (drum/bass/guitar drill) — единственный вариант не пересепарировать.

## Решения

1. **Primary остаётся `htdemucs_6s`** — единственная модель которая даёт 6 стемов нужных для drill всех инструментов.
2. **Опциональный "premium quality" path** — `mel_band_roformer_kim_ft_unwa` для пользователей которым нужен только karaoke (без drum/guitar/bass drill). Даёт −6.2pp WER, но стоит 60 дополнительных секунд и не даёт остальные стемы.
3. **MDX-Net и htdemucs_ft исключаем** из дальнейших рассмотрений.

## Двухуровневая (parallel) обработка — не сейчас

Можно было бы запускать `mel_kim` параллельно с `htdemucs_6s` (mel — для karaoke ASR, htdemucs — для drill стемов). На single-GPU это не выигрыш (queue), на split-host (CPU sep + GPU ASR) — мог бы быть. Откладываем до Phase 2 когда станет ясно нужно ли.

---

## Что дальше

- Phase 1.7 (опц.): CTC forced alignment через GigaAM-CTC + torchaudio для замены NW-baseline
- Phase 1.8: SongFormer (verse/chorus) — новая ML-нагрузка, отдельный smoke на ROCm
- Phase 1.9: chord recognition + N2N drum transcription для не-вокалистов
- Phase 2: FastAPI + arq + SSE — обернуть pipeline.process в job-сервис
