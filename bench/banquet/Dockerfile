# Banquet (query-bandit) inference image — query-based music source separation.
# Reuses stem-practice-bench:rocm so we keep the same PyTorch 2.11 + ROCm 7.12
# stack we already validated on gfx1151. Adds query-bandit's runtime deps and
# clones the upstream repo into /opt/query-bandit.
#
# Reference: https://github.com/kwatcharasupat/query-bandit
# Weights:   https://zenodo.org/records/13694558  (ev-pre-aug.ckpt, 645 MB)

FROM stem-practice-bench:rocm

USER root

# Pin to commit for reproducibility once we know it works; main is fine for first pass.
RUN git clone --depth 1 https://github.com/kwatcharasupat/query-bandit.git /opt/query-bandit

# Runtime deps inferred from train.py imports — the repo ships no requirements.txt.
# torch_audiomentations is pulled in transitively via core/data/moisesdb at import
# time, so it's required even for inference.
RUN pip install --no-cache-dir \
        "pytorch-lightning>=2.4,<2.6" \
        "torchmetrics>=1.4,<2" \
        "omegaconf>=2.3" \
        "fire>=0.6" \
        "pandas>=2.2" \
        "tqdm>=4.66" \
        "torch-audiomentations>=0.11" \
        "moisesdb"

WORKDIR /opt/query-bandit
ENV CONFIG_ROOT=/opt/query-bandit/config

CMD ["bash"]
