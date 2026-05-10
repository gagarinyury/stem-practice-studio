# ASR bench image: NVIDIA NeMo Parakeet-TDT-0.6B-v3 on AMD Strix Halo (gfx1151).
# Same base as bench/Dockerfile so we ride on its known-good ROCm PyTorch stack;
# NeMo uses whatever torch it finds, which is the ROCm wheel — no CUDA needed.
FROM kyuz0/amd-strix-halo-comfyui:latest

ENTRYPOINT []
WORKDIR /work
USER root

RUN dnf install -y time libsndfile && dnf clean all

# nemo_toolkit[asr] pulls in the full ASR stack incl. SentencePiece, transformer
# decoders, and Hypothesis types we need to read word-level timestamps from.
RUN pip install --no-cache-dir "nemo_toolkit[asr]>=2.0"

# HF cache → mounted volume so weights survive container rebuilds
ENV HF_HOME=/asr-models/hf
ENV NEMO_CACHE_DIR=/asr-models/nemo

CMD ["bash"]
