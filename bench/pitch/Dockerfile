FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# basic-pitch + librosa with their (heavy) ML deps. CPU-only is fine —
# basic-pitch ICASSP_2022 is small, runs in ~5s on a 5-sec slice.
RUN pip install --no-cache-dir \
        "basic-pitch[onnx]==0.4.0" \
        "librosa==0.10.2" \
        "soundfile>=0.12" \
        "numpy<2" \
        "swift-f0" \
        "mido"

WORKDIR /work
