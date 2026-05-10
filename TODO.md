# TODO

Короткие, переходящие из сессии в сессию пункты. Длинные планы и
обоснования — в `docs/warmup/` или `~/.claude/plans/`.

## Pipeline

- [ ] **Manual track-name fallback** — когда AcoustID не нашёл, LRClib дал
      низкий combined score (< 0.3), и ASR-fallback всё что есть, юзер
      должен иметь возможность **вручную ввести artist + title** на
      экране processing/library. После ввода: re-run `pipeline.realign`
      на этом треке, чтобы подтянуть нормальную лирику. Без этого
      редкие/самопальные треки навсегда остаются с ASR-распознанным
      текстом (с ошибками).
      Где UI: `/processing/[id]` показывает inline-форму "не нашли
      название — введи сам?" если `manifest.lrc.found = false` и
      `manifest.acoustid` пуст. На `/library` — кнопка "edit metadata"
      рядом с треком.
- [ ] LRC submit обратно в LRClib — если юзер вручную ввёл artist+title
      и LRClib теперь вернул хороший матч, можно использовать наш
      user-submit API key (`oE3OFS6h3M`) чтобы засабмитить fingerprint
      → MBID связку в AcoustID. Сделает базу полнее для всех.
