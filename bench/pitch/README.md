# Pitch detection bench

Эксперимент: насколько хорошо современные open-source детекторы превращают
демиксованный вокал в "пианино" (последовательность MIDI нот).

## Запуск

```bash
# На evo
docker build -t stem-pitch-bench bench/pitch/
docker run --rm -v /srv/apps/stem-practice-studio:/work stem-pitch-bench \
    python /work/bench/pitch/run.py /work/runs/<id> "stems/source_(Vocals)_htdemucs_6s.flac" \
    --from 30 --to 90
# → bench/pitch/out/<id>_30.0-90.0_basic_pitch.json
# → bench/pitch/out/<id>_30.0-90.0_librosa.json
```

## Превью

`preview/` — статические HTML для просмотра/прослушивания результатов.
Открываются прямо файлом в браузере (нужен dev server чтобы fetch JSON и audio):

- `pitch-preview.html` + `pitch-preview-data.json` — 5-сек слайс
  (32–37s), три представления: raw notes, cleaned, ribbon-style
- `pitch-playback.html` + `pitch-playback-data.json` — 60-сек слайс
  (30–90s), плеер с одновременным воспроизведением оригинала + синтез
  пианино из basic-pitch нот (треугольная волна с ADSR)

Чтобы посмотреть локально — скопировать HTML и JSON в `web/public/`
и открыть `http://localhost:4323/<file>.html`.

## Вывод (2026-05-10)

basic-pitch (Spotify, MIT) даёт ~9 нот на 5с фразы — на чистом
русском роке (Башлачёв) узнаваемо, но мусор есть: октавные выбросы,
дрожание между соседними полутонами на слайдах. Для production-уровня
"piano-roll как у Smule" нужна либо платная транскрипция (klangio.com,
~$ за трек), либо ручная курация MIDI для библиотеки треков. Реальные
karaoke-приложения (Smule, Yousician) используют курируемые MIDI, не
auto-detection.

Откладываем интеграцию. Frontend остаётся на `pitchy` + smooth
riverline envelope для эстетики. Возврат к этой задаче — когда
появится бюджет на curation tools или новая модель.
