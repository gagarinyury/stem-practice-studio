## Открытые вопросы автору

Обновлено после изучения макетов `Disain/screen_08…11`. Часть вопросов снята, часть появилась.

### Закрыто макетами ✓

- ~~Иконки и иллюстрации~~ → Tabler Icons, без отдельных глифов для шагов.
- ~~Quick sessions список~~ → 5 финальных (5-min revival, Reach higher, Smooth runs, Power & dynamics, Cool-down).
- ~~Хранение диапазона~~ → онбординг встроен в модуль, диапазон определяется им же.
- ~~Аудио-эталон~~ → есть кнопка `hear ref` на onboarding и `volume-2` toggle на active. Значит, нужен.

### Дизайн-инфраструктура (новые, важные)

1. **Tabler Icons — как ставим?**
   - Вариант A: `npm i @tabler/icons-react` (~5 MB tree-shakable, удобный API).
   - Вариант B: ручные SVG для нужных ~22 иконок (контроль bundle, но больше работы).
   - Рекомендация: **A** — быстрее и в проекте ещё нет icon-системы, лучше сразу нормальную.

2. **Расширение `web/lib/design/tokens.ts`** под палитру макетов (см. `design-review.md`):
   - 6 оттенков фиолетового лесенкой
   - 5 пастельных surface + 5 ink для категорий упражнений
   - `accentRecord` `#993C1D` — отдельный токен или переиспользуем `accentWarn`?
   - Italic-emphasis ink `#5F5E5A` — токен `inkSoft`?
   - **Это меняет глобальные токены** → нужно явное добро.

3. **Bottom navigation (4 таба: music / mic / chart / user)** — это глобальная навигация. Кто реализует и какие маршруты?
   - mic = `/warmup`?
   - music = `/library`?
   - chart = новый `/stats`?
   - user = новый `/profile`?
   - Если этих маршрутов ещё нет — модуль warm-up зависает в воздухе.

### Технические

4. **Pitch detection — pitchy ок?** Уже в стеке для drill. См. `pitch-detection.md`.

5. **Где живёт shared pitch service?** Если в `web/lib/pitch/` уже что-то есть для drill — переиспользуем. Если нет — создавать как общий с самого начала.

6. **Аудио-эталон для шагов** — где брать?
   - Тон-генератор (WebAudio oscillator) — дешёво, но "робот".
   - Записанные сэмплы педагога — дорого, но human-feel.
   - MVP: тон-генератор, v2: сэмплы.

7. **Запись сессии для post-session обзора** — нужно ли сохранять аудио и pitch-кривую?
   - "+1 st today" на completion подразумевает, что мы хотя бы храним пик-ноту дня.
   - Полную pitch-кривую — опционально (требует storage).

### Скоуп MVP

8. **Что в первый PR:**
   - Минимум: онбординг (1 экран, шаг 2 как на макете) + Daily 8 hub + 1 шаг сессии (sirens) + completion stub.
   - Полный: все 4 экрана + все 7 шагов Daily 8 + 5 quick sessions.
   - Рекомендация: **минимум**, итеративно.

9. **"Continue Skinny Love" bridge** — какой контракт с плеером?
   - Last-played track из localStorage / API?
   - Если нет последнего → fallback на `/library`?

10. **Streak-инфраструктура** — есть в проекте, или warm-up её вводит?
    - Если вводит: где хранится (localStorage / backend / Supabase)?

### Контент

11. **"One thing" наблюдение на completion** — генерация:
    - MVP: 5–10 правил вида *if accuracy_in_siren > 0.9 and peak > 0.75*range → "push higher next time"*.
    - v2: LLM по логу сессии (Anthropic SDK, есть в стеке).
    - Решение нужно сейчас, потому что фразы должны звучать как педагог, а не как алерт.

12. **Voice type подсказка на onboarding step 3** — границы по диапазону:
    - bass / baritone / tenor / contralto / mezzo / soprano
    - Какие именно нотные пороги? Нужна таблица — могу нарисовать default из стандартной классической классификации, но автор может хотеть adapted под эстраду.

### Дальше — что я готов делать после ответов

После закрытия 1, 2, 3, 8 — могу:
- Расширить `tokens.ts` (с PR на review).
- Поставить Tabler Icons.
- Собрать `RangeStrip` + `EditorialTitle` + `TipCard` как первый коммит (компоненты без логики).
- Развернуть HTML-прототип онбординга с реальным WebAudio + pitchy в `web/public/proto/warmup-onboarding.html` — чтобы автор попел в свой микрофон до того, как код пойдёт в Next.js.
