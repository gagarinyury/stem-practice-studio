#!/usr/bin/env bash
# Run Banquet (query-bandit) guitar extraction on the bench tracks.
#
# Usage (on evo, after Phase 0 GPU run finished — we reuse those Guitar.flac as queries):
#   bash bench/banquet/run_banquet.sh build      # build image
#   bash bench/banquet/run_banquet.sh fetch      # download ev-pre-aug.ckpt to /srv/models/stem-practice/banquet/
#   bash bench/banquet/run_banquet.sh run        # run guitar extraction on both tracks
#
# Output: bench/results/banquet_<stamp>/<track>/guitar.wav alongside summary.tsv.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BENCH_DIR="$REPO_ROOT/bench"
BANQUET_DIR="$BENCH_DIR/banquet"
TRACKS_DIR="$BENCH_DIR/tracks"
RESULTS_DIR="$BENCH_DIR/results"
WEIGHTS_DIR="${WEIGHTS_DIR:-/srv/models/stem-practice/banquet}"
CKPT_FILE="ev-pre-aug.ckpt"
CKPT_URL="https://zenodo.org/records/13694558/files/${CKPT_FILE}?download=1"
IMAGE="stem-practice-banquet:rocm"

# Reuse htdemucs_6s Guitar.flac as the query (already on disk from Phase 0).
# Pick the first GPU run dir that exists.
find_query_for_track() {
  local track="$1"
  local f
  f=$(find "$RESULTS_DIR" -path "*/htdemucs_6s/${track}/*Guitar*" -type f 2>/dev/null | head -1)
  echo "$f"
}

cmd_build() {
  echo "[build] $IMAGE"
  docker build -t "$IMAGE" "$BANQUET_DIR"
}

cmd_fetch() {
  mkdir -p "$WEIGHTS_DIR"
  if [[ -f "$WEIGHTS_DIR/$CKPT_FILE" ]]; then
    echo "[fetch] $CKPT_FILE already present ($(du -h "$WEIGHTS_DIR/$CKPT_FILE" | cut -f1))"
    return 0
  fi
  echo "[fetch] downloading $CKPT_FILE (~645 MB)"
  curl -L --fail --progress-bar -o "$WEIGHTS_DIR/$CKPT_FILE" "$CKPT_URL"
  echo "[fetch] done"
  ls -lh "$WEIGHTS_DIR/$CKPT_FILE"
}

cmd_run() {
  if [[ ! -f "$WEIGHTS_DIR/$CKPT_FILE" ]]; then
    echo "[run] checkpoint not found — run 'fetch' first"; exit 2
  fi

  local stamp; stamp=$(date +%Y%m%d-%H%M%S)
  local out_root="$RESULTS_DIR/banquet_${stamp}"
  mkdir -p "$out_root"
  local summary="$out_root/summary.tsv"
  printf "track\tstem\tquery_source\twall_seconds\tpeak_mem_mb\toutput_exists\n" > "$summary"

  echo "[run] -> $out_root"

  for track_path in "$TRACKS_DIR"/*.wav; do
    [[ -e "$track_path" ]] || { echo "[run] no .wav in $TRACKS_DIR — run download first"; exit 3; }
    local track; track=$(basename "$track_path" .wav)
    local query; query=$(find_query_for_track "$track")
    if [[ -z "$query" ]]; then
      echo "[run] no Guitar.flac query found for $track (run Phase 0 GPU bench first)"; continue
    fi

    local out_dir="$out_root/$track"
    mkdir -p "$out_dir"
    local out_file="$out_dir/guitar.wav"
    local timing="$out_dir/timing.txt"

    echo "[run] $track   query=$(basename "$query")"

    docker run --rm \
      --device /dev/kfd --device /dev/dri \
      --group-add 991 --group-add 44 \
      -v "$WEIGHTS_DIR:/weights:ro" \
      -v "$track_path:/in/${track}.wav:ro" \
      -v "$query:/in/query.flac:ro" \
      -v "$out_dir:/out" \
      "$IMAGE" \
      bash -c "
        set -e
        /usr/bin/time -v python train.py inference_byoq \
          --ckpt_path=/weights/${CKPT_FILE} \
          --input_path=/in/${track}.wav \
          --output_path=/out/guitar.wav \
          --query_path=/in/query.flac \
          --batch_size=4 \
          --use_cuda=true 2> /out/timing.txt || echo FAILED > /out/FAILED
      " || true

    local wall_s peak_mb exists
    if [[ -f "$out_dir/FAILED" ]]; then
      wall_s="FAIL"; peak_mb="FAIL"; exists="0"
    else
      wall_s=$(awk '/Elapsed \(wall clock\)/ {print $NF; exit}' "$timing" 2>/dev/null); wall_s="${wall_s:-?}"
      peak_mb=$(awk '/Maximum resident set size/ {printf "%.0f", $NF/1024; exit}' "$timing" 2>/dev/null); peak_mb="${peak_mb:-?}"
      exists=$([[ -f "$out_file" ]] && echo "1" || echo "0")
    fi
    printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$track" "guitar" "$(basename "$query")" "$wall_s" "$peak_mb" "$exists" >> "$summary"
  done

  echo
  echo "[run] summary:"
  column -t -s $'\t' "$summary"
  echo
  echo "[run] full logs in $out_root"
}

case "${1:-}" in
  build) cmd_build ;;
  fetch) cmd_fetch ;;
  run)   cmd_run ;;
  *) echo "usage: $0 {build|fetch|run}"; exit 1 ;;
esac
