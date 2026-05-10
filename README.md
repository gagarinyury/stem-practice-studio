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
