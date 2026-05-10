## Pitch detection — варианты реализации

В стеке проекта (см. web README) уже зафиксирован `pitchy` (MPM) для drill-режима в браузере. Для warm-up можно начать с него же — не плодить зависимости.

### Опция A — pitchy (MPM), рекомендую для MVP

- Уже в стеке, уже используется в drill.
- Чистый JS, ~10 KB, без модели.
- WebAudio AnalyserNode → time domain buffer → MPM autocorrelation → f0.
- Точности достаточно для голосового диапазона (C2–C6). На самых низах (бас) MPM шумнее, но для эстрадного вокала не критично.
- Latency — один frame (~20–40 мс).

**Минусы:** монофоничность (что нам и надо), но качество хуже на консонантах и придыхании. Для SOVT (lip trills, hum, "ng" siren) — отлично.

### Опция B — Basic Pitch (Spotify, TF.js)

- ML-модель, ~17 MB. Грузится один раз, кэшируется.
- Точнее на сложных тембрах, даёт MIDI-подобный output.
- Тяжело на мобильных в браузере.

**Когда переходить:** если pitchy в проде покажет проблемы на голосе юзеров на гласных шагах (4, 5, 6).

### Опция C — CREPE (TF.js)

- Самая точная из ML-моделей по f0.
- ~40 MB модель, требует TF.js + WebGL.
- Перебор для MVP. Опционально как премиум.

### Опция D — серверный pitch tracker

- Только если нужна "lab-grade" обратная связь.
- Latency сетевой → не подходит для real-time UI.
- Возможно для post-session отчёта ("вот ваш sirens, вот где сорвались").

### Решение

**MVP: pitchy (Опция A).** Если автор подтвердит — это будет шарено с drill-модулем, общий pitch service в `web/lib/pitch/` (если его ещё нет — создавать аккуратно, не ломая drill).

### Адаптивный target trajectory

Target — это просто массив `{ time_s, freq_hz }` точек, которые рисуются как пунктир. Генерация:

```ts
// псевдокод
function buildSirenTarget(range: { low: NoteName; high: NoteName }) {
  const startHz = noteToHz(range.low);                 // C3
  const peakHz  = noteToHz(transposeDown(range.high, 2)); // F4 → Eb4 (запас безопасности)
  // siren: 60 секунд, sin-волна между startHz и peakHz, 4 цикла вверх-вниз
  ...
}
```

Каждый шаг Daily 8 имеет свой генератор target'а от диапазона юзера. Контракт: `(rangeFromProfile) → TargetTrajectory`.

### Метрики на лету

- **accuracy** = доля времени, когда |userF0 − targetF0| < 50 cents.
- **smoothness** = инверсия std производной userF0 (чем плавнее — тем выше).

Обе считаются в RAF-цикле, без буферизации сессии целиком (память).
