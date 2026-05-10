## Warm-up trainer module

Документация по модулю распевок (vocal warm-up). Создаётся параллельно основному приложению, опирается на существующий design system (`web/lib/design/tokens.ts`: бумажная палитра, Cormorant Garamond + DM Mono, accentVocal `#534AB7`).

### Файлы в этой папке

- `README.md` — этот файл, оглавление
- `science.md` — выжимка из исследований (SOVT, Titze, дозировка)
- `protocol.md` — содержание сессии Daily 8 (7 шагов × ≤90с) + 5 quick sessions
- `screens.md` — спецификация всех 4 экранов (Hub / Onboarding / Active / Completion), маршруты, состояния, переиспользуемые компоненты
- `mechanics.md` — для каждого из 7 шагов Daily 8: вход, target, feedback, success criteria + общий контракт `ExerciseRunner`
- `design-review.md` — разбор макетов автора в `Disain/screen_08…11`: цвета, иконки, паттерны, что вынести в проектные токены
- `proto/` — мои HTML-макеты в стиле `Disain/`:
  - `screen_warmup_scales.html` — шаг 4 "Vowel scales" (discrete-notes механика, ladder + vowel rotation)
- `pitch-detection.md` — варианты технической реализации pitch tracker (pitchy / Basic Pitch / CREPE / WebAudio)
- `open-questions.md` — что нужно уточнить у автора, прежде чем кодить

### Source of truth по визуалу

HTML-макеты автора в `/Disain/`:
- `screen_08_warmup_hub.html` — Hub
- `screen_09_warmup_active_siren.html` — Active session (шаг "Sirens" в Daily 8)
- `screen_10_onboarding_range_test.html` — Onboarding step 2 (поиск верхней границы)
- `screen_11_warmup_completion.html` — Completion после сессии

### Статус

Дизайн-док. Все 4 макета изучены, спецификации синхронизированы. Код ещё не пишется — ждём решений по open-questions (главное: Tabler Icons, расширение токенов, bottom nav).

### Связь с основным приложением

- Голосовой диапазон юзера (`baritone · C3—F4` и т.п.) уже хранится в профиле — переиспользуется для транспонирования упражнений.
- Тренажёр — отдельная вкладка верхнего уровня (не подэкран `/play/[id]`), потому что сценарий "просто распеться" не привязан к конкретному треку.
- Pitch detection в браузере — частично пересекается с `pitchy` (MPM), который уже есть в стеке для drill-режима. См. `pitch-detection.md`.
