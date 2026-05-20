#!/usr/bin/env bash
# Watchdog for STEM production on evo.
# Cron suggestion (see ops/cron.txt):
#   */5 * * * * /srv/apps/stem-practice-studio/ops/watchdog.sh >> /var/log/stem-watchdog.log 2>&1
#
# Alerts (printed to stderr — cron emails them; redirect to log file in crontab).

set -u
TS=$(date -Iseconds)
alert() { printf '%s ALERT %s\n' "$TS" "$*" >&2; }
info()  { printf '%s info  %s\n' "$TS" "$*"; }

# 1. Orphaned GPU processes (older than 15 min)
LONG=$(ps -eo etimes,pid,comm,args | awk '$1 > 900 && $3 ~ /audio-separator|parakeet/ {print}')
if [ -n "$LONG" ]; then
  alert "long-running GPU process (>15min):"
  printf '%s\n' "$LONG" >&2
fi

# 2. Foreign GPU processes (not in expected whitelist)
if command -v rocm-smi >/dev/null 2>&1; then
  PIDS=$(rocm-smi --showpids 2>/dev/null | awk '/PID/ {for(i=1;i<=NF;i++) if($i ~ /^[0-9]+$/) print $i}')
  for pid in $PIDS; do
    name=$(ps -p "$pid" -o comm= 2>/dev/null)
    case "$name" in
      audio-separator|python|python3|parakeet*|nemo*|llama-server|"") ;;
      *) alert "foreign GPU process: pid=$pid comm=$name" ;;
    esac
  done
fi

# 3. amdgpu kernel dirt
if dmesg 2>/dev/null | tail -200 | grep -q 'VM memory stats.*non-zero when fini'; then
  alert "amdgpu kernel dirty state — reboot required"
fi

# 4. STEM containers up
for c in backend-api-1 backend-asr-1 backend-separator-1; do
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^$c\$"; then
    alert "container down: $c"
  fi
done

# 5. STEM workers /health
for url in http://127.0.0.1:8091/health http://127.0.0.1:8092/health; do
  resp=$(curl -fsS --max-time 5 "$url" 2>/dev/null)
  if [ -z "$resp" ]; then
    alert "$url unreachable"
    continue
  fi
  ready=$(printf '%s' "$resp" | sed -n 's/.*"ready":\s*\(true\|false\).*/\1/p')
  if [ "$ready" != "true" ]; then
    err=$(printf '%s' "$resp" | sed -n 's/.*"warmup_error":\s*"\([^"]*\)".*/\1/p')
    alert "$url not ready: ${err:-unknown}"
  fi
done

info "watchdog tick complete"
