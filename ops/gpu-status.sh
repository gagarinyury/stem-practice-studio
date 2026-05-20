#!/usr/bin/env bash
# Snapshot of GPU state on evo. Run when something feels off.
# Usage:  ssh evo 'bash -s' < ops/gpu-status.sh

set -u

hr() { printf '\n=== %s ===\n' "$*"; }

hr "STEM containers"
docker ps --filter name=backend --format 'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}' 2>/dev/null

hr "STEM workers /health"
for u in http://127.0.0.1:8091/health http://127.0.0.1:8092/health; do
  printf '  %s : ' "$u"
  curl -fsS --max-time 3 "$u" 2>/dev/null || echo "(unreachable)"
  echo
done

hr "GPU procs (rocm-smi)"
if command -v rocm-smi >/dev/null 2>&1; then
  rocm-smi --showpids 2>/dev/null | head -30
else
  echo "  rocm-smi not on host; try via container:"
  docker exec backend-separator-1 rocm-smi --showpids 2>/dev/null | head -30
fi

hr "Long-running inference processes (etime > 5min)"
ps -eo etime,pid,comm,args | awk 'NR==1 || ($3 ~ /audio-separator|parakeet|llama-server|python/ && $1 !~ /^[0-9]:[0-5][0-9]$/ && $1 !~ /^[0-4]:/) {print}' | head -20

hr "dmesg — last amdgpu/VM lines"
sudo dmesg 2>/dev/null | tail -200 | grep -iE 'amdgpu|VM memory|kfd' | tail -15

hr "Memory pressure"
free -h | head -3

hr "Done"
