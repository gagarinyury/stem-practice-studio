## Daily 8 — референсный протокол сессии

8 минут, 7 шагов, каждый ≤90 секунд. Структура: дыхание → прогрев без нагрузки (SOVT) → координация → артикуляция → динамика → атака → охлаждение.

Подтверждено макетом `screen_08_warmup_hub.html`: семь сегментов прогресс-бара release / sovt / siren / scale / swell / stacc / cool.

| # | Шаг | Длит. | Упражнение | Ярлык в UI |
|---|---|---|---|---|
| 1 | Body release | 60 с | Yawn-sigh + jaw shake | release |
| 2 | SOVT primer | 90 с | Lip trills + straw на средних нотах | sovt |
| 3 | Sirens | 60 с | Pitch glide на 2 октавы на "ng" | siren |
| 4 | Vowel scales | 90 с | 5-нотная гамма на [a]/[i]/[u] по полутонам | scale |
| 5 | Messa di voce | 60 с | Crescendo–decrescendo на одной комфортной | swell |
| 6 | Staccato arpeggios | 60 с | 1-3-5-8 короткими атаками | stacc |
| 7 | Cool-down hum | 60 с | Гудение на удобной ноте | cool |

**Итого: 480 секунд = 8 минут.**

### Adaptation от диапазона юзера

Из профиля берётся `{ low, high }` (например, `C3—F4`). Транспонируются:
- центральная нота для шагов 2, 4, 5, 6, 7 — середина комфорта;
- siren: старт ≈ нижняя треть диапазона, target ≈ `high − 1 tone` (запас безопасности);
- staccato arpeggio — в средней части.

### Quick sessions (финальный список из макета)

Подтверждено `screen_08`:

| Название (UI) | Описание (subtitle) | Длит. | Иконка / цвет |
|---|---|---|---|
| 5-min revival | straw + sirens · backstage rescue | 5 мин | `ti-clock-hour-3` / sand |
| Reach higher | bridging chest & head | 12 мин | `ti-arrow-bar-to-up` / violet |
| Smooth runs | agility, melisma, riffs | 10 мин | `ti-wave-sine` / mint |
| Power & dynamics | soft↔loud control | 10 мин | `ti-volume` / coral |
| Cool-down | after the show | 4 мин | `ti-moon-stars` / rose |

Цвета карточек — см. `design-review.md` (пастельные surface + dark ink).

### UI-копирайт (без жаргона)

В UI **нигде** не использовать "messa di voce", "SOVT", "phonation". Замены:
- Messa di voce → "Swell — soft to loud and back"
- SOVT primer → "Easy warm-up (lip trills + straw)"
- Sirens → "Slide low to high" (формулировка из макета)
- Staccato arpeggios → "Short attacks"
- Cool-down hum → "Cool-down hum"
- Body release → "Loosen up"
- Vowel scales → "Vowel scales"

Жаргон — только в опциональном info-попапе.

### Editorial-приём для заголовков шагов

Из макета: заголовок шага в Cormorant italic, последнее слово в более светлом ink:

> "Slide low to **high**." (где "high." курсив + `#5F5E5A`)
> "Now go **up**."

Применять к заголовкам всех 7 шагов Daily 8 — это узнаваемый стиль модуля.
