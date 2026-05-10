#!/usr/bin/env bash
# Phase 1.1: run Parakeet-TDT-v3 over the htdemucs_6s vocal stems from Phase 0.
# Run this on evo. Builds the ASR image once, then transcribes both tracks.
set -euo pipefail

cd "$(dirname "$0")"

REPO_ROOT="$(cd ../.. && pwd)"
RESULTS_BASE="${REPO_ROOT}/bench/results"
MODELS_HOST="/srv/models/stem-practice-asr"
IMAGE="stem-practice-asr:rocm"
RUN_TS="$(date -u +%Y%m%d-%H%M%S)"
RUN_DIR="${RESULTS_BASE}/asr_${RUN_TS}"

mkdir -p "${RUN_DIR}"
sudo mkdir -p "${MODELS_HOST}" && sudo chown "$(id -u):$(id -g)" "${MODELS_HOST}"

echo "[asr] building image ${IMAGE}..."
docker build -t "${IMAGE}" .

# Pick the most recent gpu_* run as the source of vocal stems.
LATEST_GPU_RUN="$(ls -dt "${RESULTS_BASE}"/gpu_* 2>/dev/null | head -1)"
if [[ -z "${LATEST_GPU_RUN}" ]]; then
    echo "[asr] no Phase 0 GPU run found under ${RESULTS_BASE}; aborting." >&2
    exit 1
fi
echo "[asr] using stems from: ${LATEST_GPU_RUN}"

# 0. Smoke test: NeMo loads and torch sees the ROCm device.
echo "[asr] === smoke: torch + nemo ==="
docker run --rm \
    --device /dev/kfd --device /dev/dri \
    --group-add 991 --group-add 44 \
    -v "${MODELS_HOST}:/asr-models" \
    "${IMAGE}" \
    python -c "import torch, nemo; print('torch', torch.__version__, 'cuda?', torch.cuda.is_available(), 'device', torch.cuda.get_device_name(0) if torch.cuda.is_available() else '-'); print('nemo', nemo.__version__)" \
    | tee "${RUN_DIR}/smoke.txt"

# 1. Transcribe each track's vocal stem.
for track in 8LL0TgWmvaE MwpMEbgC7DA; do
    src="${LATEST_GPU_RUN}/htdemucs_6s/${track}/${track}_(Vocals)_htdemucs_6s.flac"
    if [[ ! -f "${src}" ]]; then
        echo "[asr] missing vocal stem for ${track}: ${src}" >&2
        continue
    fi
    out_dir="${RUN_DIR}/${track}"
    mkdir -p "${out_dir}"

    echo "[asr] === ${track} ==="
    /usr/bin/time -v -o "${out_dir}/time.txt" \
    docker run --rm \
        --device /dev/kfd --device /dev/dri \
        --group-add 991 --group-add 44 \
        -v "${MODELS_HOST}:/asr-models" \
        -v "${LATEST_GPU_RUN}:/stems:ro" \
        -v "${out_dir}:/out" \
        -v "$(pwd):/code:ro" \
        "${IMAGE}" \
        python /code/transcribe.py \
            "/stems/htdemucs_6s/${track}/${track}_(Vocals)_htdemucs_6s.flac" \
            --out "/out/lyrics.json" \
        2>&1 | tee "${out_dir}/log.txt"
done

echo
echo "[asr] done. results: ${RUN_DIR}"
ls -la "${RUN_DIR}"
