# Stem Practice Studio — test entrypoints
.PHONY: test test-unit test-integration test-web test-smoke test-all predeploy postdeploy install-deps

PYTHON ?= python3

# Default: fast suite that catches regressions on a laptop with no evo access.
test: test-unit test-integration test-web

test-unit:
	$(PYTHON) -m pytest tests/unit -q

test-integration:
	$(PYTHON) -m pytest tests/integration -q

test-web:
	cd web && npm test --silent

# Live smoke against evo (uses STEM_*_URL env if set, otherwise evox2 defaults).
# Skipped = endpoint unreachable; FAILED = real regression on prod.
test-smoke:
	$(PYTHON) -m pytest tests/smoke -v

test-all:
	$(PYTHON) -m pytest tests/ -v

# Pre/post deploy gates — full ritual before/after pushing changes to evo.
predeploy:
	bash ops/predeploy-check.sh

postdeploy:
	bash ops/postdeploy-check.sh

install-deps:
	$(PYTHON) -m pip install pytest httpx psutil fastapi pydantic python-multipart python-slugify nanoid
