# ops — операционные правила и инструменты

Сервер: evox2 (Strix Halo / Ryzen AI Max+ 395 + Radeon 8060S gfx1151 / ROCm).
Stack: `/srv/apps/stem-practice-studio/backend/docker-compose.yml` (api + asr + separator + identify-llm + web).

iGPU **не партиционируется** — все ROCm-процессы делят один compute. Если два
инференса крутятся параллельно — деградация 5-10×. Решение: **кооперативная
очередь через файловый flock**. STEM-воркеры и любые другие проекты берут
exclusive-lock на `/var/lib/gpu-mutex/gpu.lock` перед GPU-работой → встают в
FIFO-очередь, не дерутся. Никто не отбивается, просто ждёт свою очередь.

---

## 0. Что уже сделано в коде

| Защита | Где | Как работает |
|---|---|---|
| `subprocess.Popen + wait(timeout)` + `kill()` | `bench/separate/server.py` | сирот `audio-separator` нет: убивается через `SEPARATE_TIMEOUT` сек (дефолт 600) |
| Внутренний `asyncio.Lock` | оба воркера | сериализация параллельных HTTP-запросов в одном контейнере |
| **Cross-process `flock` mutex** | `bench/gpu_mutex.py` + оба воркера | один общий ROCm-инференс на всю машину, остальные ждут |
| `busy` + `gpu_mutex_path` в `/health` | оба | мониторинг видит занятость |
| Структурный лог `[STEM-API] / [STEM-ASR] / [STEM-SEP]` | оба воркера + `pipeline/process.py` + `backend/app.py` | вся цепочка в `docker logs` |

## 1. Как чужой проект встаёт в очередь со STEM

Любой ROCm-процесс должен взять lock перед GPU-работой. Три способа:

### a) Shell-обёртка `ops/gpu-lock` (для любого бинарника)
```bash
gpu-lock llama-server -m model.gguf -ngl 999
gpu-lock python my_inference.py
```
Внутри контейнера — копируется/монтируется в `/usr/local/bin/gpu-lock`, см. template.

### b) Python: `bench/gpu_mutex.py`
```python
from bench.gpu_mutex import gpu_lock
with gpu_lock(label="my-inference"):
    model.infer(...)
```
Env `GPU_LOCK_PATH` указывает на файл lock'а (внутри контейнера `/gpu-mutex/gpu.lock`).

### c) Shell прямо
```bash
flock /var/lib/gpu-mutex/gpu.lock -- python my_inference.py
```

**Если процесс не использует ни один из этих способов — он украдёт GPU.**
Это вне нашего контроля, нужна кооперация всех участников.

## 2. Шаблон нового docker-проекта

`ops/templates/experiment.compose.yml` — копируй, заменяй `REPLACE_ME`. Главное:
- монтирует `/var/lib/gpu-mutex` → внутри становится `/gpu-mutex`
- монтирует `ops/gpu-lock` → `/usr/local/bin/gpu-lock`
- `entrypoint: ["/usr/local/bin/gpu-lock"]` оборачивает реальную команду
- `cgroup_parent: experiments.slice` — низкий приоритет CPU/IO относительно STEM
- `stop_grace_period: 30s` — даёт ROCm-runtime сделать `hipDeviceReset`

## 3. Гигиена операций — что НЕ делать

1. **Никогда `kill -9` на ROCm-процессах.** Только `docker stop` или `kill -TERM`. SIGKILL не даёт `hipDeviceReset` → амд-драйвер пишет `VM memory stats … non-zero when fini` → новый ROCm-процесс зависает.
2. **Никогда `modprobe -r amdgpu`.** Если завис — только reboot.
3. **Никогда не запускать `llama-server` руками вне docker без `gpu-lock`.** Голый bash-процесс без lock'а душит STEM до перезагрузки.
4. **При rebuild — сервисы по одному.** Не `--build api asr separator` разом: холодный warmup двух тяжёлых моделей одновременно может зависнуть.

## 4. Что делать когда что-то не так

### Трек завис у пользователя
1. `docker logs --tail 50 backend-separator-1` — смотрим на чём встал
2. `curl -s evo:8092/health | jq` — поля `busy`, `warmup_error`, `gpu_mutex_path`
3. `docker restart backend-separator-1` — мягкий рестарт
4. Если `warmup_error` упоминает HIP/ROCm и `dmesg` показывает `VM memory stats … non-zero` → reboot evo

### Хочу запустить другой проект
1. (опционально) `ssh evo 'bash -s' < ops/preflight.sh` — узнать что увидишь:
   - **PASS** — GPU свободен, стартуешь сразу
   - **QUEUE** — STEM работает, ты встанешь в очередь (не блокировка!)
   - **FAIL** — реальная проблема (грязный kernel, мёртвый контейнер) — починить
2. `docker compose up` из шаблона `ops/templates/experiment.compose.yml`
3. Когда закончил: `docker compose down -t 30`

## 5. Инструменты

| Файл | Что делает | Когда использовать |
|---|---|---|
| `bench/gpu_mutex.py` | Python context manager для кооперативной очереди | импортируется STEM-воркерами |
| `ops/gpu-lock` | shell-обёртка `flock + exec` | монтируется в чужие контейнеры |
| `ops/preflight.sh` | advisory-проверка (PASS/QUEUE/FAIL) | перед запуском нового проекта |
| `ops/watchdog.sh` | алерты на сирот / kernel-дырки / упавшие контейнеры | cron каждые 5 мин |
| `ops/gpu-status.sh` | полная картина GPU + контейнеры + dmesg | вручную, когда странно |
| `ops/templates/experiment.compose.yml` | шаблон compose нового GPU-проекта | копировать в новые проекты |
| `ops/systemd/{stem-priority,experiments}.slice` | cgroup-веса 200/50 | один раз ставится через INSTALL.md |
| `ops/cron.txt` | строки в crontab | один раз ставится через INSTALL.md |

## 6. Главное на одну строчку

**STEM и чужие проекты делят GPU через `flock /var/lib/gpu-mutex/gpu.lock`. Кто не берёт lock — крадёт GPU. Для всех новых проектов оборачивать entrypoint через `ops/gpu-lock`.**
