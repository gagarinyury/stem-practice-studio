# Stem Studio Web

Next.js frontend for Stem Practice Studio. The app uploads or submits a track,
shows live processing progress, then plays the finished stems with synced lyrics,
loop controls, tempo/pitch changes, and karaoke view.

## Local Development

```bash
npm install
npm run dev
```

The dev server runs on `http://localhost:4324`.

Frontend API calls go to `/be/*`. Next.js rewrites those requests to the backend
defined by `NEXT_PUBLIC_BACKEND_ORIGIN`.

Default backend:

```text
http://100.86.227.110:8093
```

Override example:

```bash
NEXT_PUBLIC_BACKEND_ORIGIN=http://evox2:8093 npm run dev
```

In the monorepo deployment, Docker Compose serves this app as `web` on port
`${WEB_PORT:-4324}` and points rewrites at the internal API service:

```text
NEXT_PUBLIC_BACKEND_ORIGIN=http://api:${API_PORT:-8093}
```

## Backend Services

The backend runs on the Evo-X2 server under:

```text
/srv/apps/stem-practice-studio
```

Main services:

| Service | Port | Purpose |
| --- | ---: | --- |
| `backend-web-1` | 4324 | Next.js frontend |
| `backend-api-1` | 8093 | HTTP API, tracks, files, SSE progress |
| `backend-asr-1` | 8091 | Warmed ASR service |
| `backend-separator-1` | 8092 | Warmed Demucs separator service |

The browser talks to `backend-web-1`. The frontend proxies `/be/*` to
`backend-api-1`; ASR and separator are backend internals.

## API Shape

Defined in [`lib/api.ts`](./lib/api.ts).

| Method | Path | Used for |
| --- | --- | --- |
| `GET` | `/tracks` | Track list |
| `POST` | `/tracks` | Upload file or submit URL |
| `GET` | `/tracks/:id` | Manifest and track status |
| `DELETE` | `/tracks/:id` | Delete track |
| `GET` | `/tracks/:id/events` | Server-sent progress events |
| `GET` | `/runs/:id/*` | Audio stems, source audio, aligned lyrics |

The manifest shape is defined in [`lib/manifest.ts`](./lib/manifest.ts).

## Processing Flow

The backend does the input step first, then runs lyrics and stem separation in
parallel.

```text
resolve_input
  |
  +-- lyrics branch: asr -> identify_search -> lrclib -> align
  |
  +-- stems branch: separate -> merge music stem
```

Important behavior:

- `resolve_input` is sequential. It downloads or normalizes the source audio.
- `asr` runs on the raw source audio, so it does not wait for Demucs.
- `identify_search`, `lrclib`, and `align` run after ASR in the lyrics branch.
- LRCLib exact lookup is `artist/title` first; duration is used only as a weak
  search ranking signal because YouTube length often differs from LRCLib.
- `separate` runs in parallel in the stems branch.
- The UI can receive `lyrics_ready` before stems are finished and show synced
  lyrics while the final stems are still processing.
- If LRCLib is rejected, `lrc.reason` / `aligned.reason` tells the UI why it
  fell back to ASR-only. Covers can become `partial` lyrics when only a strong
  matched range is safe to show.
- `done` means the final manifest has stems and lyrics.

## How To Read Timings

`timings_sec` values are per-stage durations. They are not meant to be summed
directly because some stages run in parallel.

Example from a 199s track:

```text
resolve_input:      4.76s
separate:          12.27s
asr:                3.56s
identify_search:    1.16s
lrclib:             9.38s
align:              0.03s
total:             18.90s
```

The wall-clock total is:

```text
resolve_input
+ max(separate, asr + identify_search + lrclib + align)

4.76 + max(12.27, 3.56 + 1.16 + 9.38 + 0.03)
= 4.76 + 14.13
= 18.89s
```

So in this run, `separate` was not the critical path. It overlapped with the
lyrics branch. The slowest branch was:

```text
asr -> identify_search -> lrclib -> align
```

The largest single stage there was `lrclib`.

## Separator Notes

The separator service keeps Demucs warm in a container:

```text
backend-separator-1
```

It exposes:

```text
http://127.0.0.1:8092/health
http://127.0.0.1:8092/separate
```

Current Demucs parameters:

```text
model: htdemucs_6s
shifts: 1
overlap: 0.1
```

The service performs a startup warm-up before reporting `ready: true`. On the
tested 187-199s tracks, a warmed separator request is around 10-12s instead of
the older cold docker-run path around 50-55s.

Useful checks on the server:

```bash
ssh evo "curl -fsS http://127.0.0.1:8092/health"
ssh evo "docker logs --tail=120 backend-separator-1"
ssh evo "docker logs --tail=180 backend-api-1"
ssh evo "docker logs --tail=180 backend-web-1"
```

## Frontend Processing UI

While a track is processing, [`components/TrackView.tsx`](./components/TrackView.tsx)
loads `source.wav` if stems are not ready yet. When the backend emits
`lyrics_ready`, the UI fetches the partial manifest and aligned lyrics. When the
backend emits `done`, the UI fetches the final manifest and swaps from source
audio to finished stems.

The header labels ASR-only and partial states so the user can distinguish
“official text not found”, “text rejected by ASR match”, and “safe partial
lyrics for a cover/short version” without reloading the page.

Progress event labels are rendered in
[`components/ProcessingScreen.tsx`](./components/ProcessingScreen.tsx).
