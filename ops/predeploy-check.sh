#!/usr/bin/env bash
# Pre-deploy gate. Run BEFORE `git push` or `docker compose up -d --build`.
#
# Layers:
#   1. unit tests      — must be GREEN (no regressions in pure logic)
#   2. integration     — must be GREEN (api routing, pipeline progression, error paths)
#   3. live smoke      — informational: shows what's CURRENTLY deployed
#
# Exit codes:
#   0 — all green, safe to deploy
#   1 — unit or integration FAILED — DO NOT deploy
#   2 — smoke regressions against CURRENT prod (informational, you choose)

set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

section() { printf '\n=== %s ===\n' "$*"; }

section "1/3 unit tests (must be green)"
if ! python3 -m pytest tests/unit -q; then
    echo
    echo "FAIL: unit tests broken. DO NOT deploy."
    exit 1
fi

section "2/4 integration tests (must be green)"
if ! python3 -m pytest tests/integration -q; then
    echo
    echo "FAIL: integration tests broken. DO NOT deploy."
    exit 1
fi

section "3/4 web tests (must be green)"
if [ -d web/node_modules ]; then
    if ! (cd web && npm test --silent); then
        echo
        echo "FAIL: web tests broken. DO NOT deploy."
        exit 1
    fi
else
    echo "SKIP: web/node_modules not installed — run 'cd web && npm install' first."
fi

section "4/4 live smoke against CURRENT prod (informational)"
echo "Hitting evox2:8091/8092/8093 to compare deploy state with local code..."
if python3 -m pytest tests/smoke -q; then
    echo
    echo "OK: prod matches local code. Deploy is a no-op for /health contract."
    exit 0
else
    echo
    echo "INFO: smoke RED against current prod. This is expected if you have"
    echo "      uncommitted changes that update /health, status.json shape, etc."
    echo "      After 'docker compose up -d --build' the smoke should turn green."
    exit 2
fi
