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

# RU — Калинов Мост (use Phase 1.4 pipeline run as the source pair).
mkdir -p "$OUT/ru-full" "$OUT/ru-vocals"

# EN — Tom Odell. Reuse the Phase 0 download + stem so the full mix and vocal
# stem are guaranteed to come from the same source file.
EN_FULL=$REPO/bench/tracks/MwpMEbgC7DA.wav
EN_VOCAL=$REPO/bench/results/gpu_20260510-091747/htdemucs_6s/MwpMEbgC7DA/MwpMEbgC7DA_\(Vocals\)_htdemucs_6s.flac

mkdir -p "$OUT/en-full" "$OUT/en-vocals"

echo
echo "[ab] === RU (GigaAM) full mix ==="
run_asr gigaam   "$PIPE_RUN/source.wav"                                            "$OUT/ru-full/lyrics.json"
echo "[ab] === RU (GigaAM) vocal stem ==="
run_asr gigaam   "$PIPE_RUN/stems/source_(Vocals)_htdemucs_6s.flac"                "$OUT/ru-vocals/lyrics.json"

echo
echo "[ab] === EN (Parakeet) full mix ==="
run_asr parakeet "$EN_FULL"                                                        "$OUT/en-full/lyrics.json"
echo "[ab] === EN (Parakeet) vocal stem ==="
run_asr parakeet "$EN_VOCAL"                                                       "$OUT/en-vocals/lyrics.json"

# Copy LRC refs for the scorer
cp "$REPO/bench/asr/preview/8LL0TgWmvaE/lrc_words.json" "$OUT/ru-lrc.json"
cp "$REPO/bench/asr/preview/MwpMEbgC7DA/lrc_words.json" "$OUT/en-lrc.json"

echo
echo "[ab] results: $OUT"
ls -la "$OUT"
