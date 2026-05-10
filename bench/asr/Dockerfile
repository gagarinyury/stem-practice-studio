# ASR bench image: Parakeet-TDT-0.6B-v3 via onnx-asr on AMD Strix Halo (gfx1151).
# Reuses the same ROCm-ready base as bench/Dockerfile so we share the kernel/userspace.
FROM kyuz0/amd-strix-halo-comfyui:latest

ENTRYPOINT []
WORKDIR /work
USER root

# soundfile needs libsndfile; time(1) for wall+RSS metrics
RUN dnf install -y time libsndfile && dnf clean all

# onnx-asr: thin wrapper around ONNX Runtime that knows Parakeet's TDT decoding
# and emits native word timestamps. Pin reasonably loose — package is small & stable.
#
# onnxruntime-rocm: AMD's ROCm execution provider build. If pip can't find a wheel
# for this base's ROCm version, the script will fall back to CPU EP (Parakeet on
# CPU INT8 still beats Whisper-large-v3 on CUDA in throughput per Agent B research).
RUN pip install --no-cache-dir \
        "onnx-asr[hub]>=0.5" \
        "soundfile>=0.12" \
        "numpy<2.0" \
    && (pip install --no-cache-dir onnxruntime-rocm \
        --index-url https://repo.radeon.com/rocm/manylinux/rocm-rel-7.0/ \
        || echo "WARN: onnxruntime-rocm wheel unavailable for this ROCm; staying on default ORT")

# Cache model weights here; mount /asr-models -> /srv/models/stem-practice-asr
ENV ONNX_ASR_HOME=/asr-models
ENV HF_HOME=/asr-models/hf

CMD ["bash"]
