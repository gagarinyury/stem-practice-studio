#!/usr/bin/env bash
# Phase 1.6 — separation-speed experiment.
# Run several separation models on the same RU source, then transcribe each
# one's vocal output with GigaAM and report sep_time / asr_time / total / WER.
set -euo pipefail
cd "$(dirname "$0")"

REPO=$(cd ../.. && pwd)
SRC=$REPO/runs/kalinov-most/source.wav
LRC_REF=$REPO/bench/asr/preview/8LL0TgWmvaE/lrc_words.json
TS=$(date -u +%Y%m%d-%H%M%S)
OUT=$REPO/bench/results/sepspeed_$TS
mkdir -p "$OUT"

if [[ ! -f $SRC ]]; then
  echo "[sepspeed] need $SRC — run Phase 1.4 pipeline first" >&2
  exit 1
fi

run_sep () {  # name, model_filename, extra_separator_args
  local name=$1 model=$2; shift 2
  local extra=("$@")
  local case_dir=$OUT/$name
  mkdir -p "$case_dir"
  echo
  echo "[sepspeed] === $name (model=$model ${extra[*]:-}) ==="
  /usr/bin/time -f '%e' -o "$case_dir/sep.time" \
  docker run --rm \
    --device /dev/kfd --device /dev/dri --group-add 991 --group-add 44 \
    -v "$(dirname "$SRC")":/in:ro \
    -v "$case_dir":/out \
    -v /srv/models/stem-practice:/models \
    stem-practice-bench:rocm \
    audio-separator "/in/$(basename "$SRC")" \
        -m "$model" \
        --model_file_dir /models \
        --output_dir /out \
        --output_format FLAC \
        "${extra[@]}" 2>&1 | tee "$case_dir/sep.log" | tail -3
}

run_asr_on_vocals () {  # case_dir
  local case_dir=$1
  local vocal
  vocal=$(ls "$case_dir"/*[Vv]ocals*.flac 2>/dev/null | head -1 || true)
  if [[ -z "$vocal" ]]; then
    echo "[sepspeed] no Vocals stem in $case_dir; skipping ASR" >&2
    return 1
  fi
  echo "[sepspeed] ASR on $(basename "$vocal")"
  /usr/bin/time -f '%e' -o "$case_dir/asr.time" \
  docker run --rm \
    --device /dev/kfd --device /dev/dri --group-add 991 --group-add 44 \
    -v /srv/models/stem-practice-asr:/asr-models \
    -v "$case_dir":/in:ro \
    -v "$case_dir":/out \
    -v "$REPO/bench/asr":/code:ro \
    stem-practice-asr:rocm \
    python /code/transcribe_gigaam.py "/in/$(basename "$vocal")" --out /out/lyrics.json \
    2>&1 | tee "$case_dir/asr.log" | tail -3
}

# Cases (model name as audio-separator expects; falls back to default name in catalog).
run_sep htdemucs_6s            htdemucs_6s.yaml
run_sep htdemucs_4             htdemucs_ft.yaml
run_sep mdx_inst_hq            UVR-MDX-NET-Inst_HQ_5.onnx        || true
run_sep mdx_voc_ft             UVR_MDXNET_KARA_2.onnx            || true
run_sep mel_kim                mel_band_roformer_kim_ft_unwa.ckpt || true

for d in "$OUT"/*/; do
  run_asr_on_vocals "$d" || true
done

# Score.
cp "$LRC_REF" "$OUT/ref-lrc.json"
echo
echo "[sepspeed] === scoring ==="
python3 - "$OUT" <<'PY'
import json, sys, re, time
from pathlib import Path

WN = re.compile(r"[^\w]+", re.UNICODE)
def norm(ws):
    out=[]
    for w in ws:
        s = WN.sub("", w.lower()).replace("ё","е")
        if s: out.append(s)
    return out

def lev(a,b):
    if not a: return len(b)
    if not b: return len(a)
    prev=list(range(len(b)+1))
    for i,ca in enumerate(a,1):
        cur=[i]
        for j,cb in enumerate(b,1):
            cur.append(min(cur[-1]+1, prev[j]+1, prev[j-1]+(0 if ca==cb else 1)))
        prev=cur
    return prev[-1]

root = Path(sys.argv[1])
ref = json.loads((root/"ref-lrc.json").read_text())
ref_words = norm([w["word"] for w in ref["words"]])

print(f"{'case':<14} {'sep_s':>8} {'asr_s':>8} {'total_s':>8} {'WER':>8}")
print("-"*52)
for case_dir in sorted(root.iterdir()):
    if not case_dir.is_dir(): continue
    name = case_dir.name
    sep_t = float((case_dir/"sep.time").read_text()) if (case_dir/"sep.time").exists() else float("nan")
    asr_t = float((case_dir/"asr.time").read_text()) if (case_dir/"asr.time").exists() else float("nan")
    total = sep_t + asr_t if asr_t == asr_t else sep_t
    asr_path = case_dir/"lyrics.json"
    if asr_path.exists():
        d = json.loads(asr_path.read_text())
        asr_words = norm([w["word"] for w in d.get("words",[])])
        edits = lev(asr_words, ref_words)
        wer = edits / max(len(ref_words),1)
        wer_s = f"{wer*100:.2f}%"
    else:
        wer_s = "—"
    print(f"{name:<14} {sep_t:>8.1f} {asr_t if asr_t==asr_t else 0:>8.1f} {total:>8.1f} {wer_s:>8}")
PY

echo
echo "[sepspeed] results: $OUT"
