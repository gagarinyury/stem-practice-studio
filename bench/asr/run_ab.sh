#!/usr/bin/env bash
# Phase 1.5 A/B: GigaAM/Parakeet on full-mix vs htdemucs vocal stem.
# Compares WER of each ASR output against the LRCLib reference text.
set -euo pipefail
cd "$(dirname "$0")"

REPO=$(cd ../.. && pwd)
PIPE_RUN=$REPO/runs/kalinov-most                          # Phase 1.4 output (RU)
PARAKEET_RUN=$REPO/bench/asr/preview/MwpMEbgC7DA           # Phase 1.1+1.2 (EN, has lrc + vocals)
TS=$(date -u +%Y%m%d-%H%M%S)
OUT=$REPO/bench/results/ab_$TS
mkdir -p "$OUT"

run_asr () {  # engine, src_audio, out_json
  local engine=$1 src=$2 out=$3
  local script
  case "$engine" in
    gigaam)   script=transcribe_gigaam.py ;;
    parakeet) script=transcribe.py ;;
    *) echo bad-engine; exit 2 ;;
  esac
  docker run --rm \
    --device /dev/kfd --device /dev/dri \
    --group-add 991 --group-add 44 \
    -v /srv/models/stem-practice-asr:/asr-models \
    -v "$(dirname "$src")":/in:ro \
    -v "$(dirname "$out")":/out \
    -v "$REPO/bench/asr":/code:ro \
    stem-practice-asr:rocm \
    python "/code/$script" "/in/$(basename "$src")" --out "/out/$(basename "$out")"
}

# RU — Калинов Мост
mkdir -p "$OUT/ru-full" "$OUT/ru-vocals"

# Need Tom Odell's full mix on host: pull it via yt-dlp run on demand.
EN_DIR=$REPO/runs/another-love
if [[ ! -f $EN_DIR/source.wav ]]; then
  echo "[ab] downloading EN source via yt-dlp..."
  mkdir -p "$EN_DIR"
  docker run --rm -v "$EN_DIR":/out stem-practice-bench:rocm \
    yt-dlp -f bestaudio --extract-audio --audio-format wav --audio-quality 0 \
           --write-info-json --no-playlist -o '/out/source.%(ext)s' \
           'https://www.youtube.com/watch?v=MwpMEbgC7DA'
fi

# We need EN vocals stem too. Reuse preview/ copy if missing under runs/.
if [[ ! -f $EN_DIR/vocals.flac ]]; then
  cp "$PARAKEET_RUN/vocals.flac" "$EN_DIR/vocals.flac"
fi

mkdir -p "$OUT/en-full" "$OUT/en-vocals"

echo
echo "[ab] === RU (GigaAM) full mix ==="
run_asr gigaam   "$PIPE_RUN/source.wav"                                            "$OUT/ru-full/lyrics.json"
echo "[ab] === RU (GigaAM) vocal stem ==="
run_asr gigaam   "$PIPE_RUN/stems/source_(Vocals)_htdemucs_6s.flac"                "$OUT/ru-vocals/lyrics.json"

echo
echo "[ab] === EN (Parakeet) full mix ==="
run_asr parakeet "$EN_DIR/source.wav"                                              "$OUT/en-full/lyrics.json"
echo "[ab] === EN (Parakeet) vocal stem ==="
run_asr parakeet "$EN_DIR/vocals.flac"                                             "$OUT/en-vocals/lyrics.json"

# Copy LRC refs for the scorer
cp "$REPO/bench/asr/preview/8LL0TgWmvaE/lrc_words.json" "$OUT/ru-lrc.json"
cp "$REPO/bench/asr/preview/MwpMEbgC7DA/lrc_words.json" "$OUT/en-lrc.json"

echo
echo "[ab] results: $OUT"
ls -la "$OUT"
