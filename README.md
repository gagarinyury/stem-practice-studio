# Stem Practice Studio

Backend and model runtime for generating playable stems, lyrics, and word-level
timings for Stem Studio.

The active backend is the warmed-service flow:

```text
web (:4324)
  -> /be/* rewrite
  -> api (:8093)
      -> yt-dlp/ffmpeg for URL input
      -> ASR service (:8091)
      -> separator service (:8092)
      -> DuckDuckGo + identify LLM (:8083)
      -> LRCLib + local alignment
      -> runtime cache for external lookups
```

## Active Structure

- `backend/` - FastAPI app, Dockerfile, compose, env example.
- `web/` - desktop Next.js frontend, served from evo on port 4324.
- `web-mobile/` - Capacitor/iOS mobile frontend shell.
- `pipeline/` - parallel processing flow and helpers:
  - `process.py` - main orchestration;
  - `clients.py` - warmed ASR/separator HTTP clients;
  - `lyrics.py` - LRCLib candidate selection and alignment gate;
  - `state.py` - manifest/status writes;
  - `yt.py` - direct `yt-dlp`/`ffmpeg` input resolution;
  - `identify.py` - candidate generation from metadata and ASR snippets;
  - `identify_search.py` - DuckDuckGo + local LLM song identification;
  - `runtime_cache.py` - runtime-only cache for identify/LRCLib responses;
  - `lrc.py` - LRC parsing helpers;
  - `align.py` - ASR/LRC word alignment.
- `bench/asr/server.py` - warmed Parakeet ASR HTTP service.
- `bench/separate/server.py` - warmed Demucs separator HTTP service.
- `backend/docker-compose.yml` - active services only.
- `docs/backend-flow-tz.md` - operational backend flow notes.

Historical benchmark artifacts remain under `bench/`.

## Services

| Service | Port | Purpose |
| --- | ---: | --- |
| `web` | 4324 | Desktop Next.js frontend |
| `api` | 8093 | HTTP API, runs, status files, SSE |
| `asr` | 8091 | Warmed Parakeet transcription |
| `separator` | 8092 | Warmed `htdemucs_6s` stem separation |
| `identify-llm` | 8083 | Dedicated warmed local LLM for song identification |

The old Redis/arq worker backend has been removed from the active tree.

## Configuration

Compose ports are centralized in the root `.env` file. Start from the template:

```bash
cp .env.example .env
```

Defaults:

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
RUNS_DIR=/srv/apps/stem-practice-studio/runs
CACHE_DIR=/srv/apps/stem-practice-studio/cache
DB_PATH=/srv/apps/stem-practice-studio/data/app.db
STUDENT_TRACK_LIMIT=10
```

`IDENTIFY_LLM_MODEL_FILE` must exist inside `IDENTIFY_LLM_MODEL_DIR` as a real
file or hardlink. Do not use a symlink that points outside the directory,
because compose mounts only `IDENTIFY_LLM_MODEL_DIR` into the container as
`/models`.

## Run

On evo:

```bash
cd /srv/apps/stem-practice-studio
cp .env.example .env  # first run only, or edit existing .env
docker compose -f backend/docker-compose.yml up -d --build
curl http://127.0.0.1:4324
curl http://127.0.0.1:8093/healthz
```

Open the app from the Mac through Tailscale:

```text
http://evox2:4324
```

Submit a URL:

```bash
curl -c /tmp/stem.cookies -H 'Content-Type: application/json' \
     -d '{"email":"you@example.com","password":"change-me-123","invite_code":"stem-..."}' \
     http://127.0.0.1:8093/auth/register

curl -b /tmp/stem.cookies -F url='https://www.youtube.com/watch?v=...' \
     -F language=ru \
     -F asr_engine=parakeet \
     http://127.0.0.1:8093/tracks
```

Events:

```bash
curl -b /tmp/stem.cookies -N http://127.0.0.1:8093/tracks/<track-id>/events
```

## Auth

The desktop app uses local email/password auth with an HttpOnly cookie. Users
and sessions live in SQLite at `DB_PATH`. Passwords are stored as PBKDF2 hashes,
not plaintext.

Endpoints:

- `POST /auth/register` - creates a `student` user and logs in. Requires
  `invite_code`.
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`

Public registration is invite-only. Invite codes live in SQLite, each code has
a human label so we can see where users came from.

Create readable community codes on evo:

```bash
cd /srv/apps/stem-practice-studio
docker compose -f backend/docker-compose.yml exec -T api \
  python tools/invite_codes.py add vocal-teacher "Vocal teacher"
docker compose -f backend/docker-compose.yml exec -T api \
  python tools/invite_codes.py add music-school "Music school"
```

Or generate a less guessable code from a label:

```bash
docker compose -f backend/docker-compose.yml exec -T api \
  python tools/invite_codes.py generate "Vocal teacher"
```

List codes and signup counts:

```bash
docker compose -f backend/docker-compose.yml exec -T api \
  python tools/invite_codes.py list
```

Give testers the public app address and their community code separately:

```text
Site: https://your-domain.example
Invite code: vocal-teacher
```

The frontend also accepts `?invite=<code>` for internal testing, but public
materials should show the short code separately.

Admin users are not created through public registration. To create or reset the
admin account, run this on evo and enter a strong password when prompted:

```bash
cd /srv/apps/stem-practice-studio
docker compose -f backend/docker-compose.yml exec api python tools/bootstrap_admin.py
```

By default this creates/updates `yury@vitai.pro`. To use another email:

```bash
docker compose -f backend/docker-compose.yml exec -e ADMIN_EMAIL=you@example.com api \
  python tools/bootstrap_admin.py
```

Tracks are owner-scoped. New runs get `user_id` in `status.json` and
`manifest.json`; `/tracks`, `/tracks/:id`, `/runs/:id/*`, SSE, delete, and
lyrics confirmation/search all require the current user. Admin can access
ownerless legacy runs, but for the MVP test legacy runs can simply be deleted.

MVP access is intentionally limited for regular users:

- `student` - can create up to 10 tracks;
- `tester` - unlimited tracks;
- `admin` - unlimited tracks.

The frontend asks for quick feedback after 3 tracks. After the 10-track limit,
new uploads are blocked and the user is asked to contact us on WhatsApp for
manual unlimited access. Existing tracks remain available.

To grant unlimited access:

```bash
python3 - <<'PY'
import sqlite3
con = sqlite3.connect("/srv/apps/stem-practice-studio/data/app.db")
con.execute("update users set role = 'tester' where email = ?", ("user@example.com",))
con.commit()
PY
```

Password reset is intentionally manual for this MVP. The login screen tells
users to write to WhatsApp. To reset a password on the server:

```bash
cd /srv/apps/stem-practice-studio
docker compose -f backend/docker-compose.yml exec -T api python - <<'PY'
import sqlite3
from backend.auth import manual_password_hash

con = sqlite3.connect("/srv/apps/stem-practice-studio/data/app.db")
con.execute(
    "update users set password_hash = ? where email = ?",
    (manual_password_hash("new-password-123"), "user@example.com"),
)
con.commit()
PY
```

Use a one-time temporary password and ask the user to change it when we add a
profile screen.

## Feedback

After a user has at least three tracks, the frontend shows a small feedback
modal once for that user. Closing it or submitting feedback stores that local UI
decision in the browser, so the MVP does not keep asking.

Feedback is stored only in SQLite at `DB_PATH`; there is no SMTP/email
dependency. To inspect recent feedback on evo:

```bash
python3 - <<'PY'
import sqlite3
con = sqlite3.connect("/srv/apps/stem-practice-studio/data/app.db")
for row in con.execute("""
    select datetime(created_at,'unixepoch'), email, rating, track_count, message
    from feedback
    order by created_at desc
"""):
    print(row)
PY
```

## Output

Each run writes into `runs/<track-id>/`:

- `source.wav`, `source.opus`, optional `video.mp4`;
- separated stems and `stems/music.flac`;
- `lyrics.json`, `lyrics_candidates.json`;
- optional `lrc.txt`, `lrc_words.json`;
- `lyrics_aligned.json`;
- `manifest.json`, `status.json`.

LRCLib exact lookup uses `artist/title` without duration first. YouTube
durations often include intros, outros, live sections, or cover edits; duration
is only a weak ranking signal during broader search. Every LRCLib hit is still
gated against Parakeet ASR before it is accepted.

If a full LRCLib text is too long for a cover or short version but the matched
phrase coverage is strong, the backend emits a partial LRC result and the
frontend labels it as partial. Only the matched lyric range is shown.

When LRCLib is missing or rejected, `manifest.lrc.reason` and
`manifest.aligned.reason` explain the ASR-only fallback:

```text
lrclib_not_found
lrclib_rejected_low_match
script_mismatch
unsupported_or_weak_asr_language
partial_cover_available
user_confirmed_lrc
```

If LRCLib candidates exist but ASR confidence is weak, the frontend can show
the candidates for manual confirmation. Confirming a candidate calls
`POST /tracks/<id>/lyrics/accept`, rebuilds `lyrics_aligned.json` from the
existing ASR output, and marks the result as `user_confirmed_lrc`. This does not
rerun download, ASR, or Demucs.

Runtime cache files live under `CACHE_DIR` and are not committed.

## Safety

- Do not delete `runs/`, `_data/`, or model directories during experiments.
- Do not use broad cleanup commands in `/srv/apps/stem-practice-studio`.
- If cleanup is needed, delete only an explicit absolute run directory after
  confirming the path.
