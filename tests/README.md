# tests

Production-grade test suite for stem-practice-studio. **91 unit/integration + 10 smoke = 101 тестов.**

## Структура

```
tests/
├── conftest.py
├── unit/                                 # pure functions, no network
│   ├── test_identify.py                  # candidate ranking, title cleanup
│   ├── test_lyrics_utils.py              # norm_word, lev, similar, script_mismatch
│   ├── test_state.py                     # atomic_write_json (+ concurrent stress)
│   ├── test_auth.py                      # passwords, sessions, user lifecycle
│   ├── test_gpu_mutex.py                 # real flock(2) with fork'd child
│   ├── test_subprocess_timeout.py        # kill on timeout, NO zombies (psutil)
│   └── test_track_id.py                  # slug bugs (incl. URL leak regression)
├── integration/                          # FastAPI TestClient + full pipeline mock
│   ├── test_api.py                       # /healthz /auth /tracks routing
│   ├── test_pipeline_failure.py          # stage=error on worker raise
│   └── test_pipeline_progression.py      # all stages emitted in order
└── smoke/                                # live evo probes
    └── test_workers_live.py              # api/asr/separator /health contract
```

## Ритуал деплоя

```bash
make predeploy       # before pushing/building
git push
ssh evo "cd /srv/apps/stem-practice-studio && git pull && docker compose -f backend/docker-compose.yml up -d --build"
make postdeploy      # waits 30s, runs smoke; must be ALL GREEN
```

`predeploy` валит сборку если unit/integration красные.
`postdeploy` валит деплой если smoke красный (значит новый код не подхватился).

## Запуск отдельно

```bash
make test            # unit + integration (~0.6s)
make test-unit
make test-integration
make test-smoke      # против evox2:8091/8092/8093
make test-all
```

## Что покрыто — карта инцидентов и тестов

| Инцидент / класс багов | Тест | Почему ловит |
|---|---|---|
| audio-separator сирота (зависший subprocess) | `test_subprocess_timeout.py::test_timeout_actually_kills_process_no_zombies` | Запускает реальный `sleep 30` с `timeout=1`, через psutil проверяет что процесс реально мёртв |
| Track stuck on "queued" forever | `test_pipeline_failure.py::test_pipeline_failure_writes_error_stage` | mock'ает run_pipeline → raise; проверяет что status.json = stage=error с message |
| URL утёк в slug (вчерашний `https-www-youtube-com-watch-v-...`) | `test_track_id.py::test_youtube_url_must_not_appear_in_slug` | дёргает `make_track_id("https://youtube.com/watch?v=X")`, regex запрещает `https|youtube|watch|www` |
| status.json race между lyrics+stems ветками | `test_state.py::test_concurrent_writes_do_not_race` | 4 потока × 50 записей одновременно; ловит `FileNotFoundError` от os.replace |
| ASR/separator /health сломан после deploy | `test_workers_live.py::TestAsrHealth/TestSeparatorHealth` | требует поля `ready`, `busy`, `gpu_mutex_path`, `separate_timeout` |
| GPU mutex не задеплоен | `test_workers_live.py::TestGpuMutexDeployed` | проверяет наличие `gpu_mutex_path` в /health |
| api залип под нагрузкой воркеров | `test_workers_live.py::TestApiResponsiveness` | /healthz должен ответить <5s даже когда воркеры busy |
| Пользователь не видит свой упавший трек | `test_pipeline_failure.py::test_error_message_includes_user_id` | проверяет что `user_id` сохраняется в error-статусе |
| 500 на /auth/me | `test_api.py::TestAuthFlow::test_me_unauthenticated` | unauth → 401, не 500 |
| Path traversal | `test_api.py::TestRunsStaticServing::test_path_traversal_blocked` | `/runs/..%2Fetc/passwd` не возвращает 200 |

## Доказательства что тесты не фикция (мутационные)

Для каждого критичного теста — ломал код, тест краснел, восстанавливал, тест зеленел:

| Что сломал | Тест поймал |
|---|---|
| `norm_word`: убрал `.replace("ё", "е")` | `test_yo_to_e`: `assert 'ёлка' == 'елка'` FAIL |
| `gpu_mutex`: убрал `fcntl.flock(...)` | `test_blocks_when_other_process_holds`: parent acquired in 0.0005s instead of 0.3s |
| `make_track_id`: оригинальный код (URL → slug) | `test_youtube_url_must_not_appear_in_slug` FAIL до фикса |
| `atomic_write_json`: вернул shared tmp name | `test_concurrent_writes_do_not_race`: FileNotFoundError × 4 потока |

Любой коммит, который случайно регресснёт эти инварианты — упадёт CI или predeploy.

## Принципы

1. **No fictional mocks.** Где можно — реальный объект: реальные subprocess'ы (sleep/true/false), реальный sqlite в tmp, реальный flock c child-process, реальный FastAPI lifecycle через TestClient.
2. **Smoke красный = деплой red.** Поэтому `postdeploy` exit 1 если smoke не позеленел — это объективный сигнал что новый код не подхватился.
3. **Тесты — это контракт деплоя.** Если новый код меняет /health-ответ, smoke падает ДО деплоя (`predeploy` показывает). После деплоя `postdeploy` это перевалидирует.
4. **Изоляция.** Каждый тест с БД получает свежий tmp-файл через reload модуля. Никаких shared state между тестами.

## CI

`.github/workflows/test.yml` гоняет unit + integration на каждый push и PR.
Smoke не в CI — GitHub Actions не имеет tailnet до evo.
