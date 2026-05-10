# Phase 0 — Source separation benchmark

Цель: на реальном железе (AMD Radeon 8060S, gfx1151, ROCm 7.12) понять качество и скорость моделей разделения, прежде чем строить pipeline.

## Запуск (на evo)

```bash
sudo mkdir -p /srv/models/stem-practice && sudo chown $USER /srv/models/stem-practice
sudo mkdir -p /srv/apps && cd /srv/apps && \
  git clone https://github.com/gagarinyury/stem-practice-studio.git
cd /srv/apps/stem-practice-studio

bash bench/run_bench.sh build      # build image (использует kyuz0/amd-strix-halo-comfyui как базу)
bash bench/run_bench.sh download   # yt-dlp → bench/tracks/*.wav
bash bench/run_bench.sh run gpu    # прогон по матрице моделей × треков на ROCm
bash bench/run_bench.sh run cpu    # повтор на CPU для сравнения
```

## Файлы

- `Dockerfile` — образ `stem-practice-bench:rocm`, наследуется от `kyuz0/amd-strix-halo-comfyui` (PyTorch 2.11 + ROCm 7.12 уже внутри).
- `tracks.txt` — список YouTube URL, по одному на строку.
- `models.txt` — список моделей формата `short_name|filename|note`. Filenames соответствуют тому, что выдаёт `audio-separator --list_models`.
- `run_bench.sh` — `build` / `download` / `run gpu|cpu` / `clean`.
- `tracks/` — скачанные WAV (gitignored).
- `results/<device>_<timestamp>/` — отдельные папки на каждый прогон + `summary.tsv` с цифрами и `<model>/<track>/timing.txt`.

## Что замеряем

- **Wall time** разделения (через `/usr/bin/time -v`)
- **Peak RSS** (мегабайтах)
- **Кол-во выходных стемов**
- Субъективное качество (открыть файлы в Audacity и послушать на bleed между стемами)

## Решение по итогу

После прогона `summary.tsv` обоих `gpu` и `cpu` — выбираем основную модель для Phase 1 и фиксируем в `results.md`.
