#!/usr/bin/env bash
# Post-deploy gate. Run AFTER `docker compose up -d --build`.
#
# All smoke tests must turn GREEN — that proves the new code is actually
# running on evo, not just sitting in git. If smoke is still red, the build
# didn't pick up your changes (cached layer, wrong service name, etc).

set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "Waiting 30s for containers to finish warmup..."
sleep 30

echo "Running full live smoke against deployed prod..."
export STEM_DEMO_TRACK_ID="${STEM_DEMO_TRACK_ID:-pull-it-apart-4SaUBA}"
if python3 -m pytest tests/smoke -v; then
    echo
    echo "DEPLOY VERIFIED: all smoke tests green. New code is live."
    exit 0
else
    echo
    echo "FAIL: smoke RED after deploy. The new code is NOT live."
    echo "  - Check 'docker compose ps' — containers running?"
    echo "  - Check 'docker logs backend-asr-1' — warmup_error?"
    echo "  - Compare /health output with expected fields"
    exit 1
fi
