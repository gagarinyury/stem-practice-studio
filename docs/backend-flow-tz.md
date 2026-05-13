# TZ: Backend Audio Processing Flow

## Goal

Build a stable backend flow for Stem Practice Studio that processes a track into:

- playable source audio while processing is still running;
- separated stems for final playback;
- clean lyrics text;
- word-level timings aligned to the actual recording;
- fast progress updates for the frontend.

The backend must prefer warmed long-running services over per-request Docker
startup, and it must never rely on a service restart to keep working.

## Current Target Architecture

```text
web (:4324)
  -> /be/* rewrite
  -> api (:8093)
  -> backend.app
  -> pipeline.process.run()
```

Long-running services:

| Service | Port | Purpose |
| --- | ---: | --- |
| `web` | 4324 | Desktop Next.js frontend |
| `api` | 8093 | HTTP API, tracks, files, SSE events |
| `asr` | 8091 | Warmed ASR service |
| `separator` | 8092 | Warmed Demucs separator service |
| `identify-llm` | 8083 | Dedicated warmed local LLM for DuckDuckGo result extraction |

Ports are configured from the repository root `.env` file:

```text
WEB_PORT=4324
API_PORT=8093
ASR_PORT=8091
SEPARATOR_PORT=8092
PARAKEET_WARMUP_SECONDS=8
IDENTIFY_LLM_PORT=8083
IDENTIFY_LLM_MODEL_DIR=/srv/models/stem-practice-llm
IDENTIFY_LLM_MODEL_FILE=Qwen3.5-2B-UD-Q5_K_XL.gguf
IDENTIFY_LLM_MODEL=qwen3.5-2b
IDENTIFY_LLM_CTX=4096
```

## Pipeline

The flow is sequential only until input is resolved. After that, lyrics and stems
must run in parallel.

```text
resolve_input
  |
  +-- lyrics branch:
  |     source audio
  |       -> ASR
  |       -> identify candidates
  |       -> fetch lyrics candidates
  |       -> align candidates against ASR
  |       -> lyrics_ready manifest
  |
  +-- stems branch:
        source audio
          -> warmed Demucs separator
          -> stems/*.flac
          -> stems/music.flac

final manifest waits for both branches
```

`total` timing is wall-clock:

```text
total = resolve_input + max(lyrics branch, stems branch) + small overhead
```

Stage timings are not additive because the branches overlap.

## Input Resolution

For URL input:

- download media through `yt-dlp`;
- keep video metadata if available;
- write source media into `runs/<track-id>/`;
- preserve enough metadata for display and candidate generation:
  - YouTube title;
  - channel/uploader;
  - duration;
  - original URL;
  - video id.

For file upload:

- write source file into `runs/<track-id>/`;
- do not require title/artist from the user.

## ASR Requirements

ASR must run on the raw full source audio, not on the separated vocal stem.

Reason:

- it can run in parallel with Demucs;
- it avoids waiting for stem separation;
- timings are for the exact recording being processed.

The ASR service must be warmed:

```text
POST http://127.0.0.1:8091/transcribe
```

Payload:

```json
{
  "audio": "/srv/apps/stem-practice-studio/runs/<id>/source.wav",
  "out": "/srv/apps/stem-practice-studio/runs/<id>/lyrics.json",
  "language": "ru"
}
```

Output file schema:

```json
{
  "model": "...",
  "engine": "...",
  "device": "cuda",
  "audio": "source.wav",
  "duration": 199.15,
  "elapsed": 3.56,
  "rtf": 0.017,
  "text": "...",
  "words": [
    { "word": "Когда", "start": 29.12, "end": 29.68 }
  ]
}
```

### Parakeet Policy

Target policy:

- use Parakeet for raw full-track ASR;
- warm Parakeet during ASR service startup before reporting healthy;
- do not load GigaAM in the production ASR service.

GigaAM can remain in benchmark scripts for historical A/B tests, but it must not
be imported or loaded by `bench/asr/server.py` in the production compose stack.

Required logging:

```text
[asr] engine=parakeet language=ru audio=... duration=... elapsed=... words=...
```

## Separator Requirements

Stem separation must use a warmed service:

```text
GET  http://127.0.0.1:8092/health
POST http://127.0.0.1:8092/separate
```

Payload:

```json
{
  "audio": "/srv/apps/stem-practice-studio/runs/<id>/source.wav",
  "out_dir": "/srv/apps/stem-practice-studio/runs/<id>"
}
```

Target Demucs settings:

```text
model: htdemucs_6s.yaml
shifts: 1
overlap: 0.1
output_format: FLAC
```

The service must warm up at startup before reporting `ready: true`.

Expected outputs:

```text
runs/<id>/stems/source_(Vocals)_htdemucs_6s.flac
runs/<id>/stems/source_(Drums)_htdemucs_6s.flac
runs/<id>/stems/source_(Bass)_htdemucs_6s.flac
runs/<id>/stems/source_(Guitar)_htdemucs_6s.flac
runs/<id>/stems/source_(Piano)_htdemucs_6s.flac
runs/<id>/stems/source_(Other)_htdemucs_6s.flac
runs/<id>/stems/music.flac
```

`music.flac` is mixed from all non-vocal stems with `ffmpeg amix`.

Measured target:

- warmed separator on 187-199s tracks: about 10-12s;
- old cold docker-run path: about 50-55s.

## Song Identification

The system must treat song identification as candidate generation, not as final
truth.

Inputs for candidates:

- ASR text snippets;
- YouTube title;
- uploader/channel;
- duration;
- optional user-provided artist/title.

Current useful method:

```text
ASR words
  -> select one or more snippets
  -> DuckDuckGo query: "lyrics <snippet>"
  -> local LLM extracts {artist, title}
```

Known risk:

- a single noisy ASR snippet can produce the wrong song.

Example risk:

```text
Video: "Время колокольчиков ... Калинов мост ... песня СашБаш"
Noisy ASR middle snippet once produced:
  Malchik-Gey - Гей
```

Therefore:

- generate multiple candidates when possible;
- include YouTube-title-derived candidates;
- do not overwrite final metadata until the lyric candidate passes alignment.

## Lyrics Fetching

LRCLib is the preferred source for clean lyrics text.

Important:

- LRCLib timestamps are not the source of truth;
- the backend uses clean LRCLib text and ASR word timings;
- LRCLib `[mm:ss.xx]` timestamps may be parsed for metadata/debugging, but final
  word timings must come from ASR alignment.

Preferred lookup order:

1. exact LRCLib get by `artist + title + duration`;
2. narrow LRCLib search by `artist + title`;
3. title-only LRCLib search;
4. other text sources if added later;
5. ASR-only fallback.

Exact lookup should be tried first because search can add several seconds.

Observed timings:

```text
LRCLib search artist+title: ~4.5s
LRCLib search title-only:   ~4.8s
LRCLib exact get:           ~3.7s
```

## Alignment Gate

Final lyric selection must be decided by alignment against ASR, not by
artist/title confidence alone.

For each lyrics candidate:

```text
candidate text
  -> parse lines
  -> words_from_lines
  -> align(candidate words, ASR words)
  -> compute quality metrics
```

Required metrics:

- `match_rate = matched / lrc_words`;
- `asr_coverage = matched / asr_words`;
- `combined_rate = min(match_rate, asr_coverage)`;
- `run_quality`: fraction of matched words in consecutive runs of length >= 3;
- `lrc_span`: how much of the lyric text has matched anchors;
- script guard: reject Cyrillic/Latin mismatches when clear.

Suggested minimum acceptance:

```text
combined_rate >= 0.55
run_quality   >= 0.40
lrc_span      >= 0.50
```

If no candidate passes, use ASR-only output.

## Alignment Output

`lyrics_aligned.json` must contain clean display words with timings from ASR:

```json
{
  "model": "lrc-aligned-via-asr-raw",
  "engine": "lrclib+parakeet+nw",
  "duration": 199.15,
  "lrc_source": {
    "artist": "Константин Ступин",
    "title": "Когда я умер",
    "synced": true
  },
  "alignment": {
    "asr_words": 84,
    "lrc_words": 82,
    "matched": 74,
    "match_rate": 0.902,
    "interpolated": 8,
    "longest_run": 19,
    "run_quality": 0.973,
    "lrc_span": 0.988
  },
  "lines": ["..."],
  "text": "...",
  "words": [
    {
      "word": "Когда",
      "line": 0,
      "start": 29.12,
      "end": 29.68,
      "match": "asr",
      "asr_word": "Когда"
    }
  ]
}
```

ASR-only fallback must keep the same frontend-compatible shape.

## Manifest Requirements

Early manifest after lyrics branch:

```json
{
  "stems": {},
  "lyrics": { "raw_asr": "lyrics.json", "engine": "parakeet" },
  "lrc": { "found": true, "artist": "...", "title": "..." },
  "aligned": { "path": "lyrics_aligned.json", "match_rate": 0.9 },
  "timings_sec": { "...": "..." }
}
```

Final manifest after both branches:

```json
{
  "stems": {
    "vocals": "stems/source_(Vocals)_htdemucs_6s.flac",
    "drums": "...",
    "bass": "...",
    "guitar": "...",
    "piano": "...",
    "other": "...",
    "music": "stems/music.flac"
  }
}
```

The frontend may load lyrics after `lyrics_ready` and swap to final stems after
`done`.

## Progress Events

Required stages:

```text
queued
resolve_input
asr
identify
lrclib
align
lyrics_ready
separate
manifest
done
error
```

Progress percentages must not imply that stages are strictly sequential after
`resolve_input`.

## Performance Targets

For a 187-199s track:

```text
resolve_input:      depends on URL/download
asr:                3-13s depending on model/audio
identify_search:    ~1-2s
lrclib:             target <4s on exact hit
align:              <0.5s
separate:           10-12s warmed
total after input:  max(lyrics branch, stems branch)
```

Known measured example:

```text
resolve_input:      4.76s
asr:                3.56s
identify_search:    1.16s
separate:          12.27s
lrclib:             9.38s
align:              0.03s
total:             18.90s
```

This means:

```text
4.76 + max(12.27, 3.56 + 1.16 + 9.38 + 0.03) = 18.90
```

## Safety Requirements

No automatic cleanup may delete project paths.

Allowed temporary locations:

```text
/tmp/stem-practice-*
```

If temporary files are created inside the repo, deletion must require a hard
path guard:

```python
assert tmp.is_absolute()
assert tmp.name.startswith(".tmp-")
assert tmp.parent == Path("/srv/apps/stem-practice-studio")
```

Forbidden:

```python
shutil.rmtree(Path("."))
shutil.rmtree(variable_from_shell_without_guard)
rm -rf "$maybe_empty"
```

Any cleanup must log the exact absolute path before deletion.

For backend experiments:

- prefer read-only inspection first;
- do not restart services until source files exist on disk;
- do not run full pipeline when testing only ASR;
- do not write test outputs into `runs/` unless explicitly requested.

## Recovery/Operational Notes

The backend must be recoverable from source files on disk. Running containers
with imported Python modules are not a valid deployment state.

Before restarting services:

```bash
python -c "from backend.app import app"
python -c "from pipeline.process import run, RunOpts"
python -c "from pipeline import yt, identify_search, lrc, align"
test -f bench/separate/server.py
```

Only after imports pass:

```bash
docker compose -f backend/docker-compose.yml restart api asr separator
```

## Open Decisions

- Make Parakeet the default for Russian full-track ASR, or expose engine choice
  explicitly.
- Add LRCLib exact-get fast path before broad search.
- Generate multiple identification candidates instead of trusting one ASR
  snippet.
- Store candidate/debug info in manifest or sidecar JSON for later inspection.
- Decide whether official artist, performer, uploader, and lyric source should
  be separate metadata fields.
