# ROCm bench image: PyTorch + audio-separator + yt-dlp on AMD Strix Halo (gfx1151).
# Base provides PyTorch 2.11 + ROCm 7.12 already wired for Radeon 8060S.
FROM kyuz0/amd-strix-halo-comfyui:latest

# Drop ComfyUI's entrypoint — we want a generic shell.
ENTRYPOINT []
WORKDIR /work

# Install audio-separator with full deps (CPU + GPU paths supported by upstream)
# and yt-dlp. Keep pip cache clean to slim the layer.
RUN pip install --no-cache-dir \
        "audio-separator[cpu]>=0.30" \
        "yt-dlp>=2025.4.0"

# audio-separator dumps weights under this dir by default; bind-mount /models to /srv/models/stem-practice
ENV AUDIO_SEPARATOR_MODEL_DIR=/models

CMD ["bash"]
