# ASR bench image: Parakeet-TDT-0.6B-v3 via onnx-asr on AMD Strix Halo (gfx1151).
# Reuses the same ROCm-ready base as bench/Dockerfile so we share the kernel/userspace.
FROM kyuz0/amd-strix-halo-comfyui:latest

ENTRYPOINT []
WORKDIR /work
USER root

# soundfile needs libsndfile; time(1) for wall+RSS metrics
RUN dnf install -y time libsndfile && dnf clean all

# onnx-asr: thin wrapper around ONNX Runtime that knows Parakeet's TDT decoding
# and emits native word timestamps.
# onnxruntime: vanilla CPU EP. Parakeet INT8 on CPU still outpaces faster-whisper
# on CUDA per Agent B benchmarks, so this is a usable baseline.
# onnxruntime-rocm AMD wheel for ROCm 7.x isn't published as of this build —
# add it later from https://repo.radeon.com/rocm/manylinux/<rel>/ when available.
RUN pip install --no-cache-dir \
        "onnxruntime>=1.20" \
        "onnx-asr[hub]>=0.5" \
        "soundfile>=0.12" \
        "numpy<2.0"

# Cache model weights here; mount /asr-models -> /srv/models/stem-practice-asr
ENV ONNX_ASR_HOME=/asr-models
ENV HF_HOME=/asr-models/hf

CMD ["bash"]
