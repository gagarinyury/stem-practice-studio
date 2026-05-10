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
**Phase 3.0** ✅ Next.js 15/16 + Tailwind v4 + design system. Tokens в `web/lib/design/tokens.ts`, primitives в `web/components/ui/`, каталог `/design`.
**Phase 3.1** ✅ Compact player `/play/[id]` — 6 стемов синхронно, mute/solo/volume, lyric karaoke, FFT live timeline (Winamp-style L/R + peak-hold).
**Phase 3.2** ✅ Karaoke video view `/karaoke/[id]` — fullscreen, YT-iframe фон с drift-correction, sliding lyric reel в нижней трети с blur-backdrop, live FFT spectrum, sidebar (vocals + music + split на 5 sub-стемов).

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

# web (Phase 3) — на Mac
cd web && npm run dev               # → http://localhost:4323
# /design     — каталог токенов и примитивов
# /play/<id>  — компактный плеер (мокап-фрейм 360px)
# /karaoke/<id> — fullscreen видео-караоке для записи
# /waveform-demo.html — sandbox для итерации визуалов спектра

# sync run-данных для веба (на Mac)
rsync -avz --exclude='source.wav' evo:/srv/apps/stem-practice-studio/runs/<slug> ~/code/stem-practice-studio/runs/
ln -sfn ../../runs ~/code/stem-practice-studio/web/public/runs
```

### Critical gotchas (для будущей разработки)

- **Docker `-v` хочет absolute paths** (`Path.resolve()`).
- **NeMo 2.7.3 на ROCm**: явно `EncDecRNNTBPEModel.from_pretrained()` (не `ASRModel.`); + monkey-patch `maybe_enable_cuda_graphs` → no-op (libcuda dlopen).
- **GigaAM**: ставить с `git+https://github.com/salute-developers/GigaAM.git` (PyPI 0.1.0 без word_timestamps); `transcribe_longform` требует pyannote (gated) → используем silero-vad chunking.
- **htdemucs_ft медленнее `_6s` в 2.5×** из-за ensemble (4 weight-файла), не TTA.
- **LRCLib quirks**: для каверов искать оригинального автора; искать с ё, не е; `--duration` для disambiguation версий.
- **Vulkan-бэкенд PyTorch не существует** для ML инференса — всё ML только на ROCm или CPU.
- **На single GPU параллелить 2 ML-задачи бессмысленно** (queue к hardware).

#### Web (Phase 3)

- **Tailwind v4 `@theme`**: токены в `globals.css` автоматически генерируют утилиты (`bg-paper`, `text-ink-muted`, `font-serif`). Не нужен `tailwind.config.ts`.
- **`node:fs` в client component ломает Turbopack**. Серверные fs-loaders выделять в `lib/*.server.ts` с маркером `import "server-only"`.
- **Hydration mismatch при `Math.random()`/`Date.now()` в `useRef` инициализаторе** → использовать React `useId()` для стабильных id между server/client.
- **WebAudio L/R FFT нужен `ChannelSplitter`** перед двумя `AnalyserNode`-ами; иначе оба видят моно-сумму.
- **YouTube IFrame API + React**: внутри `onReady` колбэка читать `playing`/`currentTime` через refs, не через closure (stale). Drift-correction делать **только** во время play — иначе seekTo на паузе вызывает loop start/stop.
- **Аудио peaks**: `gamma 0.59`, `percentile 0.78` для нормализации; `pink (i/N)^0.42` для FFT-компенсации bassy-пирамиды; `bass cut 0.07` для срезки sub-bass; `amp 0.66`, `pulse 0.39`, 100 buckets для timeline (settings подобраны итеративно через `web/public/waveform-demo.html`).
- **Manifest display fields**: `manifest.artist` для UI = реальный исполнитель в видео, `manifest.lrc.artist` = автор песни (для LRC-поиска). Для каверов это разные люди (Калинов мост vs Башлачёв).

### Дальше

См. план `~/.claude/plans/concurrent-honking-pumpkin.md`. Phase 3 покрывает web-MVP. Следующее на выбор:
- **A** — Phase 2: FastAPI + arq + SSE (бэкенд для UI-импорта вместо локального manifest)
- **B** — Phase 1.7: CTC forced alignment (улучшить точность word-таймингов)
- **C** — Phase 4: drill A-B loop + rubberband-wasm (tempo/pitch стали активными — pills в plyer уже есть, нужен AudioWorklet)
- **D** — Phase 1.8: SongFormer для verse/chorus (вернуть section-overlay в timeline)
