# TODO

Short-lived backend notes. Longer design notes live in `docs/`.

## Backend

- [ ] Add a manual artist/title correction endpoint for runs where LRCLib
      fails or alignment confidence is low. It should re-run only
      identification/lyrics/alignment in `pipeline`, not separation.
- [ ] Add a small in-process concurrency limit so one user cannot start several
      ASR/separator jobs at once.
- [ ] Add explicit retention policy for old `runs/<track-id>` directories.
      Never delete source files implicitly while debugging.
- [ ] Surface `status.json.stage = error` cleanly in the frontend, with the
      backend error message visible but not noisy.
## Verification

```bash
python3 -m py_compile \
  backend/app.py \
  pipeline/*.py \
  bench/asr/server.py bench/separate/server.py
```

On evo:

```bash
docker compose -f backend/docker-compose.yml config --quiet
curl http://127.0.0.1:8093/healthz
```
