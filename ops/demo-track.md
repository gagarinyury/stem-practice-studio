# Демо-трек (анонимный доступ)

Один трек на проде помечен как «демо» — открывается без авторизации, не
числится за конкретным юзером, не показывается в `/tracks` ни одного аккаунта.
Используется для landing-страницы (`stem.profy.top`) и онбординга — новый
посетитель сразу видит работающий разделённый трек, не регистрируясь.

## Как это работает в коде

| Слой | Где | Что делает |
|---|---|---|
| Backend | `backend/app.py::can_access_track` | если `track_id == DEMO_TRACK_ID` → доступ разрешён без user/anon-проверки |
| Backend | `backend/app.py::list_tracks` | НЕ включает демо в список пользователя, потому что `status.json` без `user_id` |
| Frontend | `web/lib/api.ts` + build-arg `NEXT_PUBLIC_DEMO_TRACK_ID` | в bundle вшит id демо-трека, фронт его автоматически грузит как «первый/featured» |

`DEMO_TRACK_ID` пробрасывается через `backend/docker-compose.yml`:
- `api` сервис: env `DEMO_TRACK_ID: "${DEMO_TRACK_ID:-}"`
- `web` сервис: build-arg + env `NEXT_PUBLIC_DEMO_TRACK_ID: "${DEMO_TRACK_ID:-}"`

## Где задаётся

`/srv/apps/stem-practice-studio/.env` на evo:
```
DEMO_TRACK_ID=pull-it-apart-4SaUBA
```

**Важно про compose v2 + env-файлы.** Compose v2 ищет `.env` рядом с
compose-файлом (`backend/.env`), а не в текущей директории. Чтобы один общий
`.env` в корне репо подхватывался, на evo стоит симлинк:
```
backend/.env -> ../.env
```
Без этого симлинка `${DEMO_TRACK_ID:-}` подставит пустую строку, демо
работать не будет, в /tracks/<demo_id> вернётся 404.

## Текущее значение на проде

```
DEMO_TRACK_ID=pull-it-apart-4SaUBA
```
Файлы лежат в `/srv/apps/stem-practice-studio/runs/pull-it-apart-4SaUBA/`,
вся папка immutable через `chattr +i -R`. Случайное `rm -rf` отобьётся даже
с sudo.

## Как заменить демо-трек

```bash
# 1. Снять immutable c прежней папки (если она остаётся)
ssh evo "sudo chattr -i -R /srv/apps/stem-practice-studio/runs/pull-it-apart-4SaUBA"

# 2. Загрузить новый mp3/wav/mp4 в shared volume (так чтобы видел api контейнер)
scp ~/Downloads/новый-трек.mp3 evo:/tmp/
ssh evo "sudo mv /tmp/новый-трек.mp3 /srv/apps/stem-practice-studio/runs/.demo-source.mp3 && \
         sudo chown yury:yury /srv/apps/stem-practice-studio/runs/.demo-source.mp3"

# 3. Прогнать pipeline в нужную папку (любой ID на выбор, без user_id)
ssh evo "docker exec backend-api-1 python3 -m pipeline.process \
         --input /srv/apps/stem-practice-studio/runs/.demo-source.mp3 \
         -o /srv/apps/stem-practice-studio/runs/<новый-track-id> \
         --title 'Название' --language ru"

# 4. Удалить промежуточный исходник
ssh evo "sudo rm /srv/apps/stem-practice-studio/runs/.demo-source.mp3"

# 5. Защитить от удаления
ssh evo "sudo chattr +i -R /srv/apps/stem-practice-studio/runs/<новый-track-id>"

# 6. Обновить DEMO_TRACK_ID в .env (если ID поменялся)
ssh evo "sed -i 's/^DEMO_TRACK_ID=.*/DEMO_TRACK_ID=<новый-track-id>/' /srv/apps/stem-practice-studio/.env"

# 7. Пересобрать api + web (web — обязательно, build-arg вшит)
ssh evo "cd /srv/apps/stem-practice-studio && \
         docker compose -f backend/docker-compose.yml up -d --build api web"

# 8. Проверить
curl -fsS https://stem.profy.top/be/tracks/<новый-track-id> | jq '{id, title, stems}'
```

## Анатомия одного демо-трека

Папка `runs/<demo_id>/`:
```
cover.jpg                      # обложка (для YouTube — берётся из mp4; для mp3 — из ID3, если есть)
source.wav                     # 44.1 kHz stereo PCM (для отдачи в web-плеер)
source.opus                    # компактный 128k Opus (для стриминга на мобиле)
video.mp4                      # если был источник-видео; иначе нет
status.json                    # stage=done, БЕЗ user_id (это и делает его «ничьим»)
manifest.json                  # стемы, lyrics, метаданные — что отдаётся клиенту
stems/                         # 7 FLAC: vocals, drums, bass, guitar, piano, other, music
  *_(Vocals)_htdemucs_6s.flac
  ...
lyrics.json                    # сырой Parakeet ASR (со словами и таймингами)
lyrics_candidates.json         # кандидаты от lrclib + от identify-LLM
lyrics_aligned.json            # финальный синхрон (lrc если нашёлся, иначе asr-only)
```

## Что нельзя делать

- ❌ `chattr +i` на родительскую папку `runs/` — сломаешь pipeline, новые
  треки не смогут создаваться.
- ❌ Прописывать `user_id` в демо-status.json — попадёт в `/tracks` владельца.
- ❌ Хардкодить ID в `compose.yml` — должно быть через env, чтобы менять без
  перекомпиляции YAML.
- ❌ Удалять `backend/.env` симлинк — compose перестанет видеть `.env` из корня.
