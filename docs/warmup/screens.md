## Спецификация экранов модуля warm-up

Source of truth по визуалу: HTML-макеты в `Disain/screen_08…11`. Этот документ — текстовая спецификация поведения и состояний (что не видно на статичном макете), плюс маршруты и компонентная декомпозиция.

Опираемся на существующий design system (`web/lib/design/tokens.ts`) + расширения, описанные в `design-review.md`.

### Маршруты

- `/warmup` — Hub (`screen_08`)
- `/warmup/onboarding` — определение диапазона, 3 шага (`screen_10` — middle step)
- `/warmup/session/[preset]` — активная сессия (`screen_09`); preset = `daily8` | `5min-revival` | `reach-higher` | `smooth-runs` | `power-dynamics` | `cooldown`
- `/warmup/session/[preset]/done` — completion (`screen_11`)

### Экран 8 — Hub (`/warmup`) → `screen_08_warmup_hub.html`

**Заголовок:** "Wake the *voice*." + eyebrow "Warm-up" + meta "tuned to your range · C3—F4" (из профиля).

**Today's session card** ("Daily 8"):
- Бейдж "— today's session" (mono uppercase, accentVocal)
- Title "Daily 8" (Cormorant italic 24px)
- Meta: "8 min · before practice / day 11 of streak"
- Round play button 56px, тёмный `#2C2C2A`
- Под карточкой — лесенка из 7 segments с градиентом фиолетового от `#534AB7` до `#EEEDFE` + подписи под каждым (release / sovt / siren / scale / swell / stacc / cool)

**Quick sessions** (5 строк, см. таблицу в `protocol.md`):
- 40px цветная иконка слева → название italic + subtitle mono → arrow-right
- Разделители — `border-top` 0.5px

**Science note:**
> "5–8 minutes is enough. The act of warming up matters more than the perfect method."

— на тёплой `surfaceMuted` плашке, eyebrow "science note" в accentVocal.

**Bottom nav:** music / **mic (active)** / chart / user — глобальная.

**Состояния:**
- Streak 0 → бейдж не показывать.
- Без онбординга (нет диапазона в профиле) → CTA Daily 8 заменяется на "Set up your range — 60s" → перекидывает на `/warmup/onboarding`.

### Экран 10 — Onboarding (`/warmup/onboarding`) → `screen_10_onboarding_range_test.html`

**Три шага, stepper наверху (24×3px, активные в accentVocal):**
1. Find your low — "Slide your voice down on 'oo'."
2. Find your high — "Now go *up*." (показано в макете)
3. Confirm — "Your range looks like: baritone." + presets для override

**На каждом шаге (1 и 2):**
- Eyebrow "— finding your range —"
- Заголовок editorial italic
- 2 строки инструкции в mono inkMuted
- Range visualizer (см. компонент ниже)
- Equalizer-полоска (анимированные зелёные столбики) + текст `listening — F#4 detected`
- Tip card на `#FAEEDA` с `ti-bulb`: "No need to push or belt. We're looking for the highest *comfortable* note."
- Три кнопки: `hear ref` 44px (volume) / **record 76px `#993C1D`** / `i'm done` 44px (check)
- Подвал: "— tap "i'm done" once you stop"

**Логика фиксации границы:**
- Pitch detection в реальном времени.
- Кандидат на границу = последняя нота, которая держалась **>800 ms** с устойчивой амплитудой (отсев случайных взвизгов).
- Юзер сам решает когда остановиться (tap "i'm done"). Алгоритм не "ловит" границу автоматически.

**Шаг 3 — confirm:**
- Финальный range strip с обеими границами и серединой
- Авто-подсказка voice type ("baritone" / "tenor" / …) от диапазона + пиковой частоты
- "Looks right?" → `Yes` / `Choose manually` (presets list)

### Экран 9 — Active session (`/warmup/session/[preset]`) → `screen_09_warmup_active_siren.html`

**Top bar:** `X` close / `3 of 7` / `volume-2` (toggle reference audio).

**Step progress:** 7 сегментов 3px, текущий полный accentVocal, будущие `#D3D1C7`. Текущий полу-прозрачный для "идёт сейчас".

**Step title block:**
- Eyebrow "— sirens —" (mono uppercase, accentVocal)
- Заголовок Cormorant italic: "Slide low to *high*." (editorial-приём)
- Meta: `on "ng" · 4 of 6 reps`

**Pitch tracker (главный визуал):**
- SVG 320×200, белая карточка, paddings.
- Шкала слева: F4 / C4 / G3 / D3 / A2 (5 тиков, mono 9px).
- Сетка пунктиром.
- **Comfort zone** — `#EEEDFE` rect, подпись "your comfort zone" в `#3C3489` 8px.
- **Target trajectory** — пунктирная фиолетовая дуга `#534AB7` opacity 0.55, dasharray 4,4.
- **User pitch** — сплошная зелёная линия `#1D9E75` 3px, `linecap round`. Растёт справа налево по мере исполнения.
- **Current point** — кружок 8px, заливка `#FAF7F2`, обводка `#1D9E75`.
- **Vertical now-line** — серая пунктирная.
- Подпись текущей ноты справа от точки: `E4` + "on pitch" (или `sharp` / `flat`).
- Подвал шкалы: `start · A2` / `target · F4` (адаптивно от диапазона).

**Live metrics (2 карточки grid 1fr/1fr):**
- accuracy 94 % (большая цифра)
- smoothness *good* (italic) + ↗ arrow

Намеренно две, не больше.

**Tip card** (мятная `#E1F5EE`):
> "Don't push at the top. If it strains, lower the target — comfort wins."

Текст меняется в зависимости от шага.

**Bottom controls:**
- `repeat` (skip-back) | **pause/play 64px тёмный** | `next` (skip-forward)
- Под ними text-link "— too high? lower by 2 semitones" (off-ramp без personal failure).

**Состояния:**
- pause → большая центральная кнопка превращается в play.
- pitch не детектится >2 сек → tip card меняется на "Sing a note — we'll catch it." без алармов.

### Экран 11 — Completion (`/warmup/session/[preset]/done`) → `screen_11_warmup_completion.html`

**Editorial header:**
- Eyebrow "— done · 8 min —" (mono uppercase, success зелёный)
- Title 38px: "Voice is *ready*." (Cormorant + italic last word)
- Meta: "streak day 12 · longest yet"

Намеренно "Voice is ready", не "Well done!" — приложение говорит про результат, а не хвалит юзера.

**Range comparison card:**
- Eyebrow "— range covered today"
- SVG range strip 320×70:
  - Шкала A2—A4
  - Лиловая полоса диапазона из профиля (C3—F4)
  - Зелёная пунктирная рамка поверх — что покрыто сегодня
  - Тёмные вертикали для границ профиля
  - Зелёная вертикаль для пика дня (если выше профильной): подпись `F#4` + меточка снизу `+1 st today`

**Metrics row:** accuracy + smoothness, как на active. Под accuracy — `+4 vs last`.

**One thing observation:**
- Eyebrow "— one thing"
- Italic body: цитата педагога-стиля, например *"Sirens were smoother around D4 today. Worth pushing slightly higher next session."*
- Генерация: правило (если accuracy в siren > 90% и пик > 75% диапазона → "push higher") либо LLM по логу сессии. Никаких списков из 5 советов — только одна.

**Next-step CTAs:**
- **Hero (тёмная `#2C2C2A`):** "Continue Skinny Love" + "62% · chorus to-do" + arrow → bridge в плеер. Это ключевой UX-bridge модуля.
- Под ним — две равные белые кнопки `see stats` | `i'm done`.

**Footer:** "— tomorrow at 19:30 · same time, same place" — тихий ритм-напоминатель (не push). Тап → настройка времени.

**Состояния:**
- Без активного трека в плеере → hero CTA заменяется на "Pick a song to practice" → `/library`.
- Если range расширился вниз — зеркальная подпись слева "−2 st today".

### Переиспользуемые компоненты

Что просится в `web/components/warmup/`:

| Компонент | Где | Пропсы |
|---|---|---|
| `RangeStrip` | onboarding step 2/3, completion | `{ low, high, current?, covered?, peak?, scale?: NoteRange }` |
| `PitchTracker` | active session | `{ target: TargetTrajectory, scale: NoteRange, comfortZone: NoteRange, onPitch: (hz) => void }` |
| `StepProgress` | active session top, hub Daily 8 card | `{ steps: string[], current: number, mode: "bar" \| "ladder" }` |
| `EditorialTitle` | везде | `{ eyebrow?, children, italicLast?: boolean }` (применяет паттерн "Wake the *voice*.") |
| `TipCard` | onboarding, active | `{ tone: "warm" \| "mint" \| "info", icon, children }` |
| `MetricTile` | active, completion | `{ label, value, suffix?, trend? }` |

Все — на дизайн-токенах из `tokens.ts` (плюс расширения по `design-review.md`).
