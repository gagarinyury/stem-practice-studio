## Механика упражнений

Для каждого из 7 шагов Daily 8 — что приложение **измеряет**, что **показывает как target**, как даёт **обратную связь** и что считает **успехом**. Это контракт между pitch-сервисом и UI.

### Общие сигналы (вход)

Что pitch-сервис гонит в RAF (~60 Hz):

| Сигнал | Источник | Применение |
|---|---|---|
| `f0_hz` | pitchy MPM | пик-нота, accuracy |
| `confidence` | MPM clarity | gate: ниже 0.7 — игнорируем кадр |
| `rms_db` | RMS из time-buffer, в dB FS | амплитуда для swell, breath, voicing |
| `onset` | spectral flux + minimum 80ms gap | атаки для staccato |
| `voiced` | f0 валиден ∧ rms > −40 dB | "юзер сейчас поёт" |

Эти 5 сигналов — единственное, что "знает" любое упражнение. Никакого распознавания техники, никакого ML по тембру.

### Шаги Daily 8

#### 1. Body release (60 с) — *no audio mechanic*

- **Вход:** ничего, или акселерометр телефона если есть.
- **Target:** короткие гайд-анимации (yawn, jaw shake, neck roll) на цикле.
- **Feedback:** только таймер и подсказки.
- **Success:** дотерпеть до конца. Auto-skip кнопкой "ready" — без штрафов.
- **Зачем без аудио:** микрофон ещё может ловить шум комнаты, голос холодный — нечего мерить.

#### 2. SOVT primer (90 с) — *sustained voicing*

- **Вход:** `voiced` + `rms_db`. f0 не критичен.
- **Target:** удержать звук на удобной средней ноте, lip trill / straw.
- **Feedback:**
  - "voicing bar" — горизонтальная полоса, заполняется пока `voiced=true`. Цель — заполнить за подход (5 × 8с с микро-паузами).
  - амплитуда — мягкий level-meter, без штрафов за тихо.
- **Success:** ≥ 70% времени voiced на каждом из 5 подходов.
- **Anti-pattern:** не штрафовать за лёгкие сбои тона (lip trill **обязан** немного "плавать"). Pitch tracker здесь скрыт.

#### 3. Sirens (60 с) — *continuous trajectory* — реализован в `screen_09`

- **Вход:** `f0_hz`, `voiced`.
- **Target:** заданная f0(t) траектория (синусоида low↔high × 4 цикла).
- **Feedback:** PitchTracker — пунктирный target + сплошная линия user.
- **Success:** доля кадров с `|user − target| < 50 cents` ≥ 80%.

#### 4. Vowel scales (90 с) — *discrete notes* — макет в `proto/screen_warmup_scales.html`

- **Вход:** `f0_hz`, `voiced`, `onset` (для перехода между нотами).
- **Target:** последовательность нот с длительностями. Базовый паттерн `do-re-mi-fa-sol-fa-mi-re-do` на текущей тональности; после успеха — transpose +1 semitone, новая гласная по циклу [a]→[i]→[u].
- **Feedback:**
  - "ladder" из 5 ступеней-нот, активная подсвечена.
  - кружок-юзер прыгает по ступеням согласно его f0 (квантованный к ближайшему полутону).
  - попадание = заполняется ступенька зелёным (когда юзер удержался на ноте >300 ms в окне ±50 cents).
- **Success per нота:** удержание >300 ms в окне ±50 cents.
- **Success per scale:** ≥ 7 из 9 нот попали → разрешаем подъём вверх по тональности.
- **Soft-fail:** если одна нота не пошла — переход вниз по тональности на следующей попытке, без алармов.

#### 5. Messa di voce (60 с) — *amplitude curve on one note*

- **Вход:** `f0_hz` (для проверки что нота держится), `rms_db` (главное).
- **Target:** одна комфортная нота + кривая `rms_db(t)`: 8с тихо → 8с громко → 8с тихо. Повторить.
- **Feedback:**
  - горизонтальный target-curve (как пульсирующая дуга снизу вверх).
  - сплошная линия user_rms поверх.
  - пик-индикатор справа: "soft −24 dB" / "loud −12 dB".
- **Success:** разница peak−valley ≥ 12 dB при сохранении f0 ±30 cents (нота не "плывёт" при изменении громкости).
- **Безопасность:** если `rms_db` > −6 dB **и** f0 уплывает — tip "ease up — let the volume come from breath, not push".

#### 6. Staccato arpeggios (60 с) — *attack pulses*

- **Вход:** `onset`, `f0_hz` на пике каждой атаки.
- **Target:** последовательность из 4 коротких нот (1-3-5-8) с заданным темпом (BPM ≈ 100).
- **Feedback:**
  - дорожка из 4 пустых "точек", заполняются в ритм метронома.
  - на каждый detected onset — точка зажигается, рядом подпись попавшей ноты.
  - timing-индикатор: "+12 ms" / "−40 ms" мягко справа.
- **Success per arpeggio:** 4/4 onset detected, средний timing-error < 80 ms, пик-ноты в ±100 cents от target.
- **Переиспользует** scales-механику (квантование f0), плюс onset-tracker.

#### 7. Cool-down hum (60 с) — *sustained voicing, low intensity*

- **Вход:** `voiced`, `rms_db`.
- **Target:** просто гудеть 60 секунд на удобной ноте, *тихо*.
- **Feedback:**
  - дыхательная "медузная" анимация в такт `rms`.
  - тёплый текст "let it settle".
- **Success:** voiced ≥ 60% времени, средний rms < −18 dB.
- **Намеренно:** никакой accuracy/scoring. Это охлаждение — не тест.

### Состояния шага (общие)

```
idle → countdown(3s) → active → [paused] → reviewing(2s) → done
                          ↓
                         skipped
```

- `countdown` — "3, 2, 1, sing" большим текстом, чтобы юзер успел вдохнуть.
- `active` — основной цикл, 1 в 1 как описано выше.
- `paused` — большая кнопка play в центре, метрики замораживаются.
- `reviewing` — 2 секунды показа итога шага ("scale climbed +1 step", "swell range 14 dB"), без блокировки next.
- `skipped` — переход к следующему шагу без штрафа стрика.

### Контракт компонента упражнения

```ts
type ExerciseStep =
  | { kind: "body"; durationS: number; cues: BodyCue[] }
  | { kind: "sovt"; durationS: number; sets: number; setS: number; centerNote: NoteName }
  | { kind: "siren"; durationS: number; trajectory: TargetTrajectory }
  | { kind: "scales"; durationS: number; pattern: NoteName[]; vowelCycle: Vowel[]; startKey: NoteName }
  | { kind: "swell"; durationS: number; centerNote: NoteName; envelope: AmplitudeEnvelope }
  | { kind: "staccato"; durationS: number; arpeggio: NoteName[]; bpm: number }
  | { kind: "hum"; durationS: number; centerNote: NoteName };

type StepResult = {
  kind: ExerciseStep["kind"];
  metrics: { accuracy?: number; smoothness?: number; rangeDb?: number; onsetsHit?: number };
  observations: string[]; // для "one thing" на completion
};
```

Один компонент `ExerciseRunner` принимает `step: ExerciseStep` + `pitchStream: Observable<PitchFrame>` и эмитит `StepResult`. UI-варианты подгружаются по `kind`.

### Что переиспользуется между шагами

| Компонент | sovt | siren | scales | swell | staccato | hum |
|---|---|---|---|---|---|---|
| `RangeStrip` | — | ✓ | ✓ | ✓ | ✓ | — |
| `PitchTracker` | — | ✓ | ✓ (квантованный) | ✓ | — | — |
| `LevelMeter` | ✓ | — | — | ✓ | — | ✓ |
| `OnsetTrack` | — | — | — | — | ✓ | — |
| `VoicingBar` | ✓ | — | — | — | — | ✓ |
| `BreathBlob` | — | — | — | — | — | ✓ |

6 атомарных визуальных модулей покрывают все 7 шагов. Это даёт смету по компонентам.
