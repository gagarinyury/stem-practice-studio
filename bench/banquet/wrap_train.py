"""
Wrapper that monkey-patches torchaudio.load to use soundfile, then dispatches
to query-bandit's train.py via Fire.

Why: the kyuz0 base image ships PyTorch 2.11 nightly whose ABI doesn't match
any released torchcodec wheel — torchcodec's libtorchcodec_core*.so all fail
to load with `undefined symbol: torch_dtype_float4_e2m1fn_x2`. New torchaudio
delegates load() to torchcodec exclusively, so torchaudio.load() is broken.

Soundfile uses libsndfile directly (no torch ABI), reads WAV/FLAC fine, and
returns numpy arrays we wrap into a tensor in torchaudio's expected layout.
"""
import sys
import numpy as np
import torch
import soundfile as sf
import torchaudio


def _shim_load(path, *args, **kwargs):
    data, sr = sf.read(str(path), always_2d=True)
    # soundfile returns (frames, channels); torchaudio expects (channels, frames)
    waveform = torch.from_numpy(data.T.astype(np.float32))
    return waveform, sr


torchaudio.load = _shim_load

# Now dispatch to train.py functions exactly like its native CLI does.
sys.path.insert(0, "/opt/query-bandit")
import train  # noqa: E402  — ordering matters
import fire   # noqa: E402

fire.Fire(train)
