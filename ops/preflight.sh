#!/usr/bin/env bash
# Advisory preflight before launching a foreign GPU project on evo.
#
# This script NEVER refuses launch. It tells you what to expect:
#   - PASS  : GPU idle, your project starts immediately
#   - QUEUE : STEM (or another project) is using GPU; you'll wait via gpu mutex
#   - FAIL  : Real problem (kernel dirt, dead containers); fix before launching
#
# Usage:  ssh evo 'bash -s' < ops/preflight.sh
# Exit 0 = PASS, 1 = QUEUE (informational), 2 = FAIL.

set -u
QUEUE=0
FAIL=0

say() { printf '%s\n' "$*"; }
ok()    { say "  ok    $*"; }
queue() { say "  queue $*"; QUEUE=$((QUEUE+1)); }
fail()  { say "  FAIL  $*"; FAIL=$((FAIL+1)); }

say "=== preflight: STEM containers"
for c in backend-api-1 backend-asr-1 backend-separator-1; do
  if docker ps --format '{{.Names}} {{.Status}}' | grep -q "^$c "; then
    ok "$c up"
  else
    fail "$c not running"
  fi
done

say "=== preflight: STEM workers reachable"
for url in http://127.0.0.1:8091/health http://127.0.0.1:8092/health; do
  if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
    ok "$url"
  else
    fail "$url unreachable"
  fi
done

say "=== preflight: GPU mutex state"
LOCK=/var/lib/gpu-mutex/gpu.lock
if [ -f "$LOCK" ]; then
  HOLDER=$(cat "$LOCK" 2>/dev/null | head -1)
  if [ -n "$HOLDER" ]; then
    queue "GPU mutex held: $HOLDER"
  else
    ok "GPU mutex idle"
  fi
else
  ok "GPU mutex never used (you'll be first)"
fi

say "=== preflight: STEM workers busy?"
for url in http://127.0.0.1:8091/health http://127.0.0.1:8092/health; do
  busy=$(curl -fsS --max-time 3 "$url" 2>/dev/null | sed -n 's/.*"busy":\s*\(true\|false\).*/\1/p')
  if [ "$busy" = "true" ]; then
    queue "$url busy — you'll queue behind STEM"
  else
    ok "$url idle"
  fi
done

say "=== preflight: dmesg (kernel state)"
if sudo dmesg 2>/dev/null | tail -100 | grep -qi 'VM memory stats.*non-zero when fini'; then
  fail "dmesg shows amdgpu dirty state — REBOOT REQUIRED before launching anything"
  sudo dmesg | tail -100 | grep -i 'VM memory\|amdgpu' | tail -10
else
  ok "dmesg clean"
fi

say "=== preflight: rogue host-level inference processes"
ROGUE=$(ps -eo pid,comm,args | awk '/llama-server|vllm|tgi/ && !/docker/ && !/grep/ {print}')
if [ -z "$ROGUE" ]; then
  ok "no host-level inference processes"
else
  fail "host-level inference detected (run only inside docker with gpu-lock!):"
  printf '%s\n' "$ROGUE"
fi

say ""
if [ "$FAIL" -gt 0 ]; then
  say "PREFLIGHT: FAIL ($FAIL real problem[s]) — fix before launching"
  exit 2
elif [ "$QUEUE" -gt 0 ]; then
  say "PREFLIGHT: QUEUE ($QUEUE wait point[s]) — safe to launch, will wait via gpu mutex"
  exit 1
else
  say "PREFLIGHT: PASS — GPU idle, you'll start immediately"
  exit 0
fi
