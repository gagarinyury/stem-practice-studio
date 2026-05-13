# Stem Practice Studio

Backend and model runtime for generating playable stems, lyrics, and word-level
timings for Stem Studio.

The active backend is the warmed-service flow:

```text
frontend
  -> api (:8093)
      -> yt-dlp/ffmpeg for URL input
      -> ASR service (:8091)
      -> separator service (:8092)
      -> DuckDuckGo + local LLM (:8080)
      -> LRCLib + local alignment
```

## Active Structure

- `backend/` - FastAPI app, Dockerfile, compose, env example.
- `pipeline/` - parallel processing flow and helpers:
  - `process.py` - main orchestration;
  - `clients.py` - warmed ASR/separator HTTP clients;
  - `lyrics.py` - LRCLib candidate selection and alignment gate;
  - `state.py` - manifest/status writes;
  - `yt.py` - direct `yt-dlp`/`ffmpeg` input resolution;
  - `identify.py` - candidate generation from metadata and ASR snippets;
  - `identify_search.py` - DuckDuckGo + local LLM song identification;
  - `lrc.py` - LRC parsing helpers;
  - `align.py` - ASR/LRC word alignment.
- `bench/asr/server.py` - warmed Parakeet/GigaAM ASR HTTP service.
- `bench/separate/server.py` - warmed Demucs separator HTTP service.
- `backend/docker-compose.yml` - active services only.
- `docs/backend-flow-tz.md` - operational backend flow notes.

Historical benchmark artifacts remain under `bench/`.

## Services

| Service | Port | Purpose |
| --- | ---: | --- |
| `api` | 8093 | HTTP API, runs, status files, SSE |
| `asr` | 8091 | Warmed Parakeet/GigaAM transcription |
| `separator` | 8092 | Warmed `htdemucs_6s` stem separation |
| `llama-swap` | 8080 | External local LLM used by identification |

The old Redis/arq worker backend has been removed from the active tree.

## Run

On evo:

```bash
cd /srv/apps/stem-practice-studio
docker compose -f backend/docker-compose.yml up -d --build
curl http://127.0.0.1:8093/healthz
```

Submit a URL:

```bash
curl -F url='https://www.youtube.com/watch?v=...' \
     -F language=ru \
     -F asr_engine=parakeet \
     http://127.0.0.1:8093/tracks
```

Events:

```bash
curl -N http://127.0.0.1:8093/tracks/<track-id>/events
```

## Output

Each run writes into `runs/<track-id>/`:

- `source.wav`, `source.opus`, optional `video.mp4`;
- separated stems and `stems/music.flac`;
- `lyrics.json`, `lyrics_candidates.json`;
- optional `lrc.txt`, `lrc_words.json`;
- `lyrics_aligned.json`;
- `manifest.json`, `status.json`.

## Safety

- Do not delete `runs/`, `_data/`, or model directories during experiments.
- Do not use broad cleanup commands in `/srv/apps/stem-practice-studio`.
- If cleanup is needed, delete only an explicit absolute run directory after
  confirming the path.
