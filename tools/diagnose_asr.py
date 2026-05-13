#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any


def post_json(url: str, payload: dict[str, Any], timeout: int = 600) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def text_from(data: dict[str, Any]) -> str:
    value = data.get("text") or data.get("transcript") or data.get("result") or ""
    if isinstance(value, list):
        return " ".join(str(x) for x in value)
    return str(value)


def run_parakeet(audio: Path, out_dir: Path, language: str, base_url: str) -> dict[str, Any]:
    out = out_dir / "parakeet.json"
    t0 = time.perf_counter()
    post_json(
        f"{base_url.rstrip('/')}/transcribe",
        {
            "audio": str(audio.resolve()),
            "out": str(out.resolve()),
            "language": language,
            "engine": "parakeet",
        },
    )
    data = read_json(out)
    data["_diagnostic_elapsed"] = round(time.perf_counter() - t0, 2)
    data["_diagnostic_output"] = str(out)
    return data


def run_gigaam(audio: Path, out_dir: Path, language: str, base_url: str) -> dict[str, Any]:
    out = out_dir / "gigaam.json"
    t0 = time.perf_counter()
    cmd = [
        "curl",
        "-fsS",
        f"{base_url.rstrip('/')}/v1/audio/transcriptions",
        "-F",
        f"file=@{audio.resolve()}",
        "-F",
        "model=gigaam-v3",
        "-F",
        f"language={language}",
        "-F",
        "response_format=json",
    ]
    raw = subprocess.check_output(cmd, text=True)
    data = json.loads(raw) if raw.strip() else {}
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    data["_diagnostic_elapsed"] = round(time.perf_counter() - t0, 2)
    data["_diagnostic_output"] = str(out)
    return data


def resolve_audio(args: argparse.Namespace) -> Path:
    if args.audio:
        return Path(args.audio)
    runs_dir = Path(args.runs_dir or os.environ.get("RUNS_DIR", "/srv/apps/stem-practice-studio/runs"))
    if not args.track_id:
        raise SystemExit("--audio or --track-id is required")
    return runs_dir / args.track_id / "source.wav"


def summarize(name: str, data: dict[str, Any]) -> dict[str, Any]:
    text = text_from(data)
    words = data.get("words") if isinstance(data.get("words"), list) else []
    return {
        "engine": name,
        "elapsed": data.get("_diagnostic_elapsed"),
        "model": data.get("model"),
        "word_count": len(words) if words else len(text.split()),
        "output": data.get("_diagnostic_output"),
        "preview": text[:900],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Compare production Parakeet with an optional diagnostic ASR.")
    ap.add_argument("--track-id")
    ap.add_argument("--audio")
    ap.add_argument("--runs-dir")
    ap.add_argument("--language", default="ru")
    ap.add_argument("--parakeet-url", default=os.environ.get("ASR_URL", "http://127.0.0.1:8091"))
    ap.add_argument("--gigaam-url", default=os.environ.get("GIGAAM_URL", "http://127.0.0.1:8082"))
    ap.add_argument("--engine", choices=["parakeet", "gigaam", "both"], default="both")
    ap.add_argument("--out-dir", help="Keep raw diagnostic outputs here. Defaults to a temp dir.")
    args = ap.parse_args()

    audio = resolve_audio(args)
    if not audio.exists():
        raise SystemExit(f"audio not found: {audio}")

    if args.out_dir:
        out_dir = Path(args.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        cleanup = None
    else:
        cleanup = tempfile.TemporaryDirectory(prefix="stem-asr-diag-")
        out_dir = Path(cleanup.name)

    results = []
    if args.engine in {"parakeet", "both"}:
        results.append(summarize("parakeet", run_parakeet(audio, out_dir, args.language, args.parakeet_url)))
    if args.engine in {"gigaam", "both"}:
        results.append(summarize("gigaam", run_gigaam(audio, out_dir, args.language, args.gigaam_url)))

    print(json.dumps({"audio": str(audio), "results": results}, ensure_ascii=False, indent=2))
    if cleanup:
        cleanup.cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
