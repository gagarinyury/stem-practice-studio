# Telegram Mini App — parallel experiment

План параллельной сборки `stem-practice-studio` как Telegram Mini App,
без воздействия на прод `stem.profy.top`.

## Цель

Завернуть существующий `web/` (Next.js) в Telegram Mini App. Проверить
UX в Telegram WebView, темизацию, BackButton, viewport. Не ломать прод.

## Архитектура

Шарим тяжёлый бэкенд (модели в RAM/VRAM), изолируем только фронт.

```
браузер на телефоне             Telegram WebView (эксперимент)
        │                                   │
        ▼                                   ▼
https://stem.profy.top              https://tg.profy.top
        │                                   │
   cloudflared (один туннель, два ingress)
        │                                   │
        ▼                                   ▼
  backend-web-1:4324                  tg-web-1:4424
        │                                   │
        └──────────────┬────────────────────┘
                       ▼
            shared: api:8093, asr:8091,
            separator:8092, identify-llm:8083
            (один бэкенд, одна SQLite)
```

**Side-effect:** база юзеров/треков общая. Пока тестирую сам — окей.
Когда подтянутся внешние тестеры → решать (отдельный db или флаг `is_tg`).

## Шаги

### 1. Git-ветка
```bash
cd /Users/yurygagarin/code/stem-practice-studio
git checkout -b tg-experiment
git push -u origin tg-experiment
```
Прод-деплой делается с `main`. Эксперимент — с `tg-experiment`. Не мерджить
обратно, пока не созреет.

### 2. Compose-файл (на ветке)

Создать `backend/docker-compose.tg.yml`:

```yaml
# Поднимает только tg-web-1 на :4424. Бэкенд берёт из основного compose.
# Запускать с COMPOSE_PROJECT_NAME=stem-tg чтобы не конфликтовать с main.
services:
  tg-web:
    build:
      context: ..
      dockerfile: web/Dockerfile
    container_name: tg-web-1
    restart: unless-stopped
    ports:
      - "0.0.0.0:4424:4324"
    environment:
      # Указываем на тот же api что и прод (через docker network main backend)
      NEXT_PUBLIC_API_BASE: http://backend-api-1:8093
    networks:
      - backend_default  # external network main compose
networks:
  backend_default:
    external: true
    name: backend_default  # уточнить реальное имя — `docker network ls`
```

⚠️ имя сети backend основного compose нужно подтвердить через
`docker network ls | grep backend` перед написанием.

### 3. На evox2 — отдельный клон

```bash
ssh evo
sudo mkdir -p /srv/apps/stem-tg
sudo chown yury:yury /srv/apps/stem-tg
git clone https://github.com/gagarinyury/stem-practice-studio.git /srv/apps/stem-tg
cd /srv/apps/stem-tg
git checkout tg-experiment
COMPOSE_PROJECT_NAME=stem-tg docker compose -f backend/docker-compose.tg.yml up -d --build
```

### 4. Cloudflare Tunnel — новый ingress

Добавить в `/home/yury/.cloudflared/config.yml` **до** `service: http_status:404`:

```yaml
- hostname: tg.profy.top
  service: http://localhost:4424
```

Создать DNS:
```bash
docker run --rm -v /home/yury/.cloudflared:/home/nonroot/.cloudflared \
  cloudflare/cloudflared:latest tunnel route dns stem-profy-top tg.profy.top
```

Перезапустить туннель: `docker restart cloudflared`.

### 5. Telegram Mini App wrapper

На ветке `tg-experiment` в `web/`:

```bash
npm install @telegram-apps/sdk-react
```

Создать `web/lib/telegram.ts` — обёртка:
- `WebApp.ready()` при mount
- читать `WebApp.themeParams` → пробросить в CSS-переменные (или
  смапить на наши `--color-paper`, `--color-ink`, `--color-accent-vocal`)
- `WebApp.BackButton.show()` когда внутри трека, hide — на главной
- `WebApp.expand()` чтобы Telegram дал нам полную высоту
- Не использовать обычный `<a>` в `target=_blank` — Telegram блокирует;
  открывать внешние ссылки через `WebApp.openLink`

В `app/layout.tsx` подключить `https://telegram.org/js/telegram-web-app.js`
(или через npm package с `client:only` импортом).

### 6. BotFather

1. Создать бота через `@BotFather` (если ещё нет): `/newbot`
2. `/setmenubutton` → Web App → URL `https://tg.profy.top`
3. (опционально) `/newapp` для отдельного Mini App entry с
   собственным URL/иконкой/описанием

### 7. Тестирование

В Telegram → бот → нажать menu button → загружается mini app в WebView.
DevTools на Mac:
1. Telegram Desktop → правый клик на mini app → Inspect (на macOS работает
   в Telegram Desktop с включённым debug режимом: `--debug-mode` флаг или
   через `settings → advanced → debug log`)
2. Альтернатива — Eruda console (`npm i eruda`, подключить в layout
   только когда `WebApp.platform !== 'unknown'` или дев-режим).

## Что НЕ трогать

- Прод-deploy на `main` (`backend-web-1:4324`, `backend-api-1`, `asr`,
  `separator`, `identify-llm`) — общая инфраструктура остаётся
- Существующий ingress `stem.profy.top` в cloudflared
- DNS-записи `*.profy.top` кроме нового `tg`
- Базу `/srv/apps/stem-practice-studio/backend/...sqlite` напрямую не
  трогать, доступ только через общий api

## Что задокументировать после старта

Минимум, в стиле других evox2-доков:
- Одна строка в таблице сервисов `GMKtec Evo-X2/README.md`:
  `tg-web-1 | 4424 | tg-experiment.md | Telegram Mini App experimental build`
- Короткий `GMKtec Evo-X2/tg-experiment.md` (15-20 строк): что, как
  запустить/остановить, что в production-ready ветке когда созреет
- Обновить `cloudflare/dns-snapshot-cloudflare.md` с новым CNAME `tg`

## Открытые вопросы (решать на старте)

1. **База юзеров shared или isolated?** Default — shared (общий
   `api:8093`). Если решим isolated — поднимать второй `tg-api` с
   собственной sqlite, второй `tg-asr`/`tg-separator` (или попробовать
   шарить asr/separator stateless — они без БД).
2. **Что если Telegram WebView ломает наш viewport?** Telegram даёт
   `viewportHeight`/`viewportStableHeight`. Использовать вместо `100vh`
   (на iOS `100vh` глючит в WebView).
3. **Auth flow:** сейчас в `stem` register+login по email+password+invite.
   В TG логичнее `tg-initData` валидация (HMAC-SHA256 от bot token) →
   автоматический логин. Это надо допилить на бэке — отдельный endpoint
   `POST /auth/telegram` принимает initData, валидирует, создаёт/находит
   юзера, выдаёт session cookie. ВАЖНО: invite-код всё равно нужен,
   просто фронт его берёт из start_param Telegram-ссылки
   (`?startapp=natythompson` → `WebApp.initDataUnsafe.start_param`).

## Откат

Если эксперимент не зайдёт:
```bash
ssh evo
docker compose -f /srv/apps/stem-tg/backend/docker-compose.tg.yml down
rm -rf /srv/apps/stem-tg
```
+ удалить ingress `tg.profy.top` из cloudflared config + перезапустить
+ удалить DNS-запись:
```bash
source ~/.config/cloudflare/profy-top.env
curl -s -X DELETE -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records/<id>"
```
+ удалить локальную ветку `git branch -D tg-experiment` (после `git checkout main`).
