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

## Что дальше

- Скачать стемы на Mac, послушать в Audacity на bleed между дорожками (особенно guitar/other и bass/drums).
- Phase 1: написать pipeline/process.py поверх htdemucs_6s + MelBand + Parakeet ONNX.
