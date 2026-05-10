## Разбор макетов автора (`Disain/screen_08…11`)

Прочитаны все 4 HTML-мокапа. Здесь — что в них зафиксировано (и должно стать source of truth), что отличается от моего draft, и что нужно вынести в проектные токены / зависимости.

### Общая визуальная грамматика (одинаково на всех 4)

- **Контейнер фрейма:** `max-width: 360px`, `border-radius: 28px`, фон `#FAF7F2` (paper из tokens). Это mobile-first preview.
- **Status bar:** "9:41" + wifi/battery (DM Mono 11px) — копируется как декоративный header.
- **Шрифты:** `Cormorant Garamond` для всех заголовков и "editorial" текста, `DM Mono` для метаданных, тэгов, цифр. Оба уже есть в проекте.
- **Editorial italic-приём:** последнее слово заголовка курсивом и более светлым цветом `#5F5E5A`. Примеры: "Wake the *voice*.", "Now go *up*.", "Voice is *ready*.", "Slide low to high.". Это паттерн модуля — переиспользовать.
- **Микро-eyebrow над заголовками:** mono 9–10px, uppercase, letter-spacing 0.18–0.2em, цвет accentVocal `#534AB7` или success `#1D9E75`. Префикс "—" обязателен: "— sirens —", "— today's session", "— done · 8 min —", "— finding your range —".

### Цвета — палитра шире, чем в `tokens.ts`

В макетах используются цвета, которых **нет** в `web/lib/design/tokens.ts`. До реализации нужно решить: расширять токены или оставлять hex inline.

**Фиолетовая шкала (для warm-up accent + прогресс-сегменты):**
- `#3C3489` — accentVocal-deep (текст по фиолетовому)
- `#534AB7` — accentVocal (уже в tokens)
- `#7F77DD`
- `#AFA9EC`
- `#CECBF6`
- `#EEEDFE` — accentVocal-tint (фон comfort zone, бэйджи)

Применение: цветовая лесенка из 7 сегментов на хабе (release → cool) — чем дальше, тем светлее. Это умное визуальное решение: "глубина" сессии без слов.

**Пастельные карточки для quick sessions (по типу упражнения):**
| Цвет фона | Цвет текста/иконки | Где |
|---|---|---|
| `#FAEEDA` | `#854F0B` / `#633806` | 5-min revival (clock), tip card на onboarding |
| `#EEEDFE` | `#3C3489` | Reach higher (arrow-up) |
| `#E1F5EE` | `#085041` / `#04342C` | Smooth runs (sine), success tip card |
| `#FAECE7` | `#993C1D` | Power & dynamics (volume) |
| `#FBEAF0` | `#993556` | Cool-down (moon) |

**Запись/active CTA:** `#993C1D` (warm warn-цвет), **не** accentVocal. Это намеренное семантическое решение: акт записи голоса = тёплое предупреждение, не "просто кнопка".

**Success/listening:** `#1D9E75` (`accentSuccess` уже в tokens) + темнее `#085041` для текста.

### Иконки — Tabler Icons

Все макеты используют `<i class="ti ti-…">`. Это [Tabler Icons](https://tabler.io/icons), новой зависимости в проекте нет. Используются:
`ti-wifi`, `ti-battery-3`, `ti-player-play-filled`, `ti-player-pause-filled`, `ti-player-skip-back/forward`, `ti-clock-hour-3`, `ti-arrow-bar-to-up`, `ti-wave-sine`, `ti-volume`, `ti-volume-2`, `ti-moon-stars`, `ti-arrow-right`, `ti-info-circle`, `ti-bulb`, `ti-music`, `ti-microphone-2`, `ti-chart-bar`, `ti-user`, `ti-x`, `ti-chevron-left`, `ti-check`, `ti-arrow-up-right`.

**Решение нужно:** ставим `@tabler/icons-react` (~5 MB tree-shakable) или копируем нужные SVG руками. См. open-questions.

### Bottom navigation (на скрине 8)

Pill-таб-бар: music / **mic (active)** / chart / user. Это глобальная навигация приложения, warm-up сидит под "mic". На активной/онбординг/completion-экранах nav скрыт (это правильный паттерн full-task screens).

### Конкретные обновления к моим спекам

**Quick sessions — финальный список (отличается от моего draft):**
1. **5-min revival** — straw + sirens · backstage rescue
2. **Reach higher** — bridging chest & head · 12 min
3. **Smooth runs** — agility, melisma, riffs · 10 min
4. **Power & dynamics** — soft↔loud control · 10 min
5. **Cool-down** — after the show · 4 min

→ Обновить `protocol.md` (там были другие названия типа "Quick wake-up").

**Daily 8 структура — подтверждена ровно как у меня:**
release / sovt / siren / scale / swell / stacc / cool. Семь сегментов, 8 минут.

**Onboarding — 3 шага, не 1:**
- Шаг 1: нижняя граница ("go down")
- Шаг 2: верхняя ("Now go up.") — это и показано в screen_10
- Шаг 3: подтверждение + voice type ("Your range looks like: baritone")

**Onboarding controls — три кнопки в ряд:**
- Слева: `hear ref` (volume icon, 44px, белая) — референс-тон если потерял ориентацию
- Центр: запись 76px, `#993C1D` — главная red record
- Справа: `i'm done` (check, 44px, белая) — фиксировать максимум

**Active session — кнопки внизу:**
- Skip back ("repeat") / pause 64px тёмный / skip forward ("next")
- Под ними text-link "— too high? lower by 2 semitones"

**Completion — три CTA:**
- Hero (тёмная `#2C2C2A`): "Continue Skinny Love" с прогрессом песни — bridge в плеер
- Под ним: `see stats` | `i'm done` (две равные белые карточки)
- Footer: "— tomorrow at 19:30 · same time, same place" (rhythm reminder, не push-нотификация)

**Метрики — только две, везде одинаково:**
- accuracy (XX%, на completion + "+4 vs last")
- smoothness (good / steady / "↗" arrow)

Score 100-балльной "готовности голоса" не вводится — было бы выдумкой.

**Range visualization — единый паттерн:**
SVG шкала A2—A4, шесть подписанных тиков (A2, D3, G3, C4, F4, A4), полоса диапазона `#534AB7` opacity 0.18, вертикальные тёмные линии для границ диапазона `#3C3489`. На completion поверх — пунктирная зелёная рамка "covered today" + новая пиковая нота с подписью "+1 st today".

Это **переиспользуемый компонент** — выносить в `web/components/warmup/RangeStrip.tsx` (или подобное) с пропсами `{ low, high, current?, covered?, peak? }`.

### Что добавить в проектную инфраструктуру

1. Решение по Tabler Icons (зависимость или ручные SVG).
2. Расширение `web/lib/design/tokens.ts`:
   - `color.accentVocalDeep` `#3C3489`, `accentVocalTint` `#EEEDFE`, плюс лесенка на 7 шагов
   - Палитра pastel surfaces для категорий упражнений (5 цветов фон + 5 цветов ink)
   - `color.accentRecord` `#993C1D` (если warn недостаточно семантичен)
3. Italic-emphasis utility — Cormorant italic + ink `#5F5E5A`. Можно как Tailwind-класс `text-ink-soft italic` или React-компонент `<Soft>`.

Эти изменения трогают общий design system → требуют согласования (open-questions q11).
