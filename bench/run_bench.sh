#!/usr/bin/env bash
# Phase 0 benchmark runner for stem-practice-studio.
#
# Runs audio-separator across the model/track matrix on the AMD Radeon 8060S
# (Strix Halo / gfx1151) and on CPU as a fallback comparison. All work happens
# inside the stem-practice-bench:rocm Docker image — nothing is installed on host.
#
# Layout (host paths, all under this repo's checkout dir):
#   bench/tracks.txt   — YouTube URLs (one per line)
#   bench/models.txt   — pipe-delimited model list
#   bench/tracks/      — downloaded audio (gitignored)
#   bench/results/     — separated stems + timing logs (gitignored)
#   bench/results.md   — appended summary table (committed)
#
# On evo, before running:
#   sudo mkdir -p /srv/models/stem-practice && sudo chown $USER /srv/models/stem-practice
#   sudo mkdir -p /srv/apps && cd /srv/apps && \
#     git clone https://github.com/gagarinyury/stem-practice-studio.git
#
# Then: cd /srv/apps/stem-practice-studio && bash bench/run_bench.sh build
#       bash bench/run_bench.sh download
#       bash bench/run_bench.sh run gpu
#       bash bench/run_bench.sh run cpu

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH_DIR="$REPO_ROOT/bench"
MODELS_DIR="${MODELS_DIR:-/srv/models/stem-practice}"
TRACKS_DIR="$BENCH_DIR/tracks"
RESULTS_DIR="$BENCH_DIR/results"
IMAGE="stem-practice-bench:rocm"

mkdir -p "$TRACKS_DIR" "$RESULTS_DIR" "$MODELS_DIR"

cmd_build() {
  echo "[build] docker build $IMAGE"
  docker build -t "$IMAGE" "$BENCH_DIR"
}

cmd_download() {
  echo "[download] tracks listed in tracks.txt → $TRACKS_DIR"
  docker run --rm \
    -v "$BENCH_DIR:/bench:ro" \
    -v "$TRACKS_DIR:/tracks" \
    "$IMAGE" \
    bash -c '
      set -e
      cd /tracks
      grep -v "^\s*#\|^\s*$" /bench/tracks.txt | while IFS= read -r url; do
        echo "[yt-dlp] $url"
        # %(id)s.%(ext)s keeps filenames stable for re-runs
        yt-dlp -x --audio-format wav --audio-quality 0 \
          -o "%(id)s.%(ext)s" \
          --no-playlist \
          "$url" || echo "[yt-dlp] failed for $url"
      done
      echo "[download] done"
      ls -la /tracks
    '
}

# Run separation: $1 = device (gpu|cpu)
cmd_run() {
  local device="${1:-gpu}"
  local separator_flag
  local devices_args=()
  case "$device" in
    gpu)
      separator_flag=""  # default: GPU if available
      devices_args=(--device /dev/kfd --device /dev/dri --group-add 991 --group-add 44)
      ;;
    cpu)
      separator_flag="--use_cpu"
      ;;
    *) echo "usage: run_bench.sh run [gpu|cpu]"; exit 2 ;;
  esac

  local stamp="$(date +%Y%m%d-%H%M%S)"
  local log_dir="$RESULTS_DIR/${device}_${stamp}"
  mkdir -p "$log_dir"
  local summary="$log_dir/summary.tsv"
  printf "model\ttrack\tdevice\twall_seconds\tpeak_mem_mb\toutputs\n" > "$summary"

  echo "[run] device=$device → $log_dir"

  # Loop over models × tracks
  while IFS="|" read -r short fname note; do
    # Skip comments / empty lines
    [[ -z "${short// }" || "$short" =~ ^[[:space:]]*# ]] && continue

    for track_path in "$TRACKS_DIR"/*.wav; do
      [[ -e "$track_path" ]] || { echo "[run] no .wav in $TRACKS_DIR — run download first"; exit 3; }
      local track="$(basename "$track_path" .wav)"
      local out_dir="$log_dir/${short}/${track}"
      mkdir -p "$out_dir"
      local timing_log="$out_dir/timing.txt"

      echo "[run] $short × $track ($device)"
      # /usr/bin/time -v captures wall + RSS; we extract from stderr after run.
      docker run --rm \
        "${devices_args[@]}" \
        -v "$MODELS_DIR:/models" \
        -v "$track_path:/in/${track}.wav:ro" \
        -v "$out_dir:/out" \
        "$IMAGE" \
        bash -c "
          set -e
          /usr/bin/time -v audio-separator /in/${track}.wav \
            -m '$fname' \
            --output_dir /out \
            --model_file_dir /models \
            $separator_flag 2> /out/timing.txt || echo 'audio-separator FAILED' > /out/FAILED
        " || true

      # Extract metrics
      local wall_s peak_mb outputs
      if [[ -f "$out_dir/FAILED" ]]; then
        wall_s="FAIL"; peak_mb="FAIL"; outputs="FAIL"
      else
        wall_s=$(awk '/Elapsed \(wall clock\)/ {print $NF}' "$timing_log" || echo "?")
        peak_mb=$(awk '/Maximum resident set size/ {printf "%.0f", $NF/1024}' "$timing_log" || echo "?")
        outputs=$(ls "$out_dir"/*.{wav,flac,mp3} 2>/dev/null | wc -l | tr -d ' ')
      fi
      printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$short" "$track" "$device" "$wall_s" "$peak_mb" "$outputs" >> "$summary"
    done
  done < "$BENCH_DIR/models.txt"

  echo
  echo "[run] summary:"
  column -t -s $'\t' "$summary"
  echo
  echo "[run] full logs in $log_dir"
}

cmd_clean() {
  echo "[clean] removing $RESULTS_DIR/* (tracks kept)"
  rm -rf "$RESULTS_DIR"/*
}

case "${1:-}" in
  build)    cmd_build ;;
  download) cmd_download ;;
  run)      shift; cmd_run "${1:-gpu}" ;;
  clean)    cmd_clean ;;
  *)
    cat <<EOF
usage: $0 <command>
  build      Build stem-practice-bench:rocm Docker image
  download   Download URLs from tracks.txt as wav into bench/tracks/
  run gpu    Run separation on AMD GPU (default)
  run cpu    Run separation on CPU for comparison
  clean      Remove bench/results/* (tracks kept)
EOF
    exit 1 ;;
esac
