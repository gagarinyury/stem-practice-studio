# Установка ops-инструментов на evo

Делается один раз. Все шаги — `ssh evo`.

## 1. Скопировать репо на сервер (если ещё нет)
```bash
ssh evo
cd /srv/apps/stem-practice-studio
git pull
chmod +x ops/preflight.sh ops/watchdog.sh ops/gpu-status.sh
```

## 2. Создать каталог GPU mutex
```bash
sudo mkdir -p /var/lib/gpu-mutex
sudo chmod 777 /var/lib/gpu-mutex   # любой контейнер сможет flock
```

## 3. Установить cgroup-слайсы
```bash
sudo cp ops/systemd/stem-priority.slice /etc/systemd/system/
sudo cp ops/systemd/experiments.slice  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start stem-priority.slice experiments.slice
```
Проверить:
```bash
systemctl status stem-priority.slice
systemctl status experiments.slice
```

## 4. Добавить `cgroup_parent` в STEM docker-compose
В `/srv/apps/stem-practice-studio/backend/docker-compose.yml` каждому сервису
(api / asr / separator / llama-swap) добавить:
```yaml
    cgroup_parent: stem-priority.slice
    stop_grace_period: 30s
```
Потом:
```bash
docker compose -f backend/docker-compose.yml up -d
```

## 5. Применить изменения к STEM
```bash
docker compose -f backend/docker-compose.yml up -d --build asr separator
# Проверить что lock пробрасывается:
curl -s http://127.0.0.1:8092/health | grep gpu_mutex_path
# Должно быть: "gpu_mutex_path":"/gpu-mutex/gpu.lock"
```

## 5a. Симлинк .env для compose v2

Compose v2 ищет `.env` рядом с compose-файлом (`backend/.env`), а не в
корне репо. Чтобы один общий `.env` в корне работал:
```bash
ln -sfn ../.env /srv/apps/stem-practice-studio/backend/.env
```
Без этого env-vars без хардкод-дефолтов (например `DEMO_TRACK_ID`) подставятся
пустыми. См. [demo-track.md](demo-track.md).

## 6. Установить watchdog в cron
```bash
sudo touch /var/log/stem-watchdog.log
sudo chown root:root /var/log/stem-watchdog.log
sudo crontab -e
# вставить содержимое ops/cron.txt
```
Проверить через 5 мин:
```bash
tail -20 /var/log/stem-watchdog.log
```

## 7. Установить env-флаг таймаута сепаратора (опционально)
По умолчанию 600 сек. Если нужен другой — в docker-compose.yml сервиса separator:
```yaml
    environment:
      SEPARATE_TIMEOUT: "900"
```

## 8. Проверить что preflight видит здоровый стейт
```bash
cd /srv/apps/stem-practice-studio
bash ops/preflight.sh
# Должно быть: PREFLIGHT: PASS
```

---

## Когда обновлять

| Что | Когда |
|---|---|
| `git pull` + `docker compose up -d --build` | при изменении кода воркеров (`bench/separate`, `bench/asr`) |
| Обновить cron | при изменении `ops/cron.txt` |
| Перезапустить слайсы | редко — только если меняли веса в `.slice` |
