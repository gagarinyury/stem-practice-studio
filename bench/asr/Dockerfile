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

# GigaAM (Sber) — Russian ASR with native word_timestamps (added 2026-04, only
# on git main; PyPI v0.1.0 is stale). We bypass GigaAM's bundled longform
# pipeline (which requires pyannote VAD behind HF auth) and use silero-vad
# directly — open weights, no token, comparable quality.
RUN pip install --no-cache-dir \
        "gigaam @ git+https://github.com/salute-developers/GigaAM.git" \
        "silero-vad>=5.1"

# HF cache → mounted volume so weights survive container rebuilds
ENV HF_HOME=/asr-models/hf
ENV NEMO_CACHE_DIR=/asr-models/nemo

CMD ["bash"]
