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

## Что дальше

- Phase 1.2: SongFormer для verse/chorus меток (новый чип — отдельный smoke на ROCm)
- Phase 1.3: chord recognition + N2N drum transcription
- Phase 1.4: единый `pipeline/process.py` поверх всего стека
