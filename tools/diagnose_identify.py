#!/usr/bin/env python3
"""Diagnose ASR -> DDG -> identify -> LRCLib for one YouTube URL.

Default mode is server-side: this local script SSHes into evo and runs the
worker inside the already-running api container. YouTube download, ffmpeg,
Parakeet ASR, DDG, LLM, LRCLib and reports all stay on the server.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import shlex
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from pipeline.identify import add_candidate, asr_snippets, title_candidates
from pipeline.identify_search import SYSTEM_PROMPT, clean_text, parse_json_content, parse_result_title
from pipeline.lyrics import choose as choose_lyrics


def run(cmd: list[str], *, cwd: Path | None = None, capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )


def require_tool(name: str) -> None:
    try:
        run(["which", name], capture=True)
    except subprocess.CalledProcessError:
        raise SystemExit(f"missing required tool: {name}")


def print_summary(report: dict[str, Any], report_path: Path | str, *, media_removed: bool) -> None:
    meta = report["metadata"]
    asr = report["asr_summary"]
    print("\n=== SUMMARY ===")
    print(f"metadata: artist={meta.get('uploader')!r}, channel={meta.get('channel')!r}, title={meta.get('title')!r}")
    print(
        "asr: "
        f"{asr.get('words')} words, "
        f"elapsed={asr.get('elapsed'):.2f}s, "
        f"wall={asr.get('wall_elapsed'):.2f}s"
    )
    timings = report.get("timings_sec") or {}
    if timings:
        print("timings: " + ", ".join(f"{k}={v:.2f}s" for k, v in timings.items()))
    for item in report["snippets"]:
        print(f"\nDDG {item['index']}: {item['query']}")
        for result in item["ddg_results"][:5]:
            print(f"  {result['rank']}. {result['title']} [{result['domain']}]")
        llm = item.get("llm")
        if llm:
            print(f"  LLM: {llm.get('parsed') or llm.get('error') or llm.get('content')}")
    pick_debug = report["lrclib"]
    if pick_debug.get("entry"):
        entry = pick_debug["entry"]
        print(f"\nLRCLib pick: {entry.get('artistName')} - {entry.get('trackName')}")
        print(f"match: {pick_debug.get('stats')}")
    else:
        print("\nLRCLib pick: none")
    print(f"\nreport: {report_path}")
    if media_removed:
        print("media: removed (use --keep-media to keep source audio)")


def normalize_youtube_url(url: str) -> str:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return url
    if parsed.hostname and "youtu" in parsed.hostname:
        vid = urllib.parse.parse_qs(parsed.query).get("v", [None])[0]
        if vid:
            return f"https://www.youtube.com/watch?v={vid}"
    return url


def download_audio(url: str, out_dir: Path) -> tuple[Path, dict[str, Any]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    clean_url = normalize_youtube_url(url)
    run(
        [
            "yt-dlp",
            "-f",
            "bestaudio/best",
            "--write-info-json",
            "--no-write-playlist-metafiles",
            "--no-playlist",
            "--playlist-items",
            "1",
            "-o",
            str(out_dir / "source.%(ext)s"),
            clean_url,
        ]
    )
    info_path = out_dir / "source.info.json"
    info = json.loads(info_path.read_text(encoding="utf-8"))
    media = next(
        p
        for p in out_dir.glob("source.*")
        if p.name != "source.info.json" and not p.name.endswith(".part") and p.suffix.lower() != ".wav"
    )
    wav = out_dir / "source.wav"
    run(["ffmpeg", "-y", "-i", str(media), "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", str(wav)])
    meta = {
        "id": info.get("id"),
        "title": info.get("track") or info.get("title"),
        "uploader": info.get("artist") or info.get("creator") or info.get("uploader"),
        "channel": info.get("channel"),
        "duration": info.get("duration"),
        "url": url,
        "yt_title": info.get("title"),
        "yt_track": info.get("track"),
        "yt_artist": info.get("artist"),
        "yt_creator": info.get("creator"),
    }
    return wav, meta


def remote_transcribe(
    wav: Path,
    *,
    ssh_host: str,
    asr_url: str,
    language: str,
    remote_root: str,
    keep_remote: bool,
) -> dict[str, Any]:
    remote_dir = f"{remote_root.rstrip('/')}/stem-identify-debug-{uuid4().hex[:12]}"
    remote_wav = f"{remote_dir}/source.wav"
    remote_json = f"{remote_dir}/lyrics.json"
    try:
        run(["ssh", ssh_host, "mkdir", "-p", remote_dir])
        run(["scp", "-q", str(wav), f"{ssh_host}:{remote_wav}"])
        payload = json.dumps(
            {"audio": remote_wav, "out": remote_json, "language": language, "engine": "parakeet"},
            ensure_ascii=False,
        )
        remote_cmd = (
            "curl -sS -X POST "
            f"{shlex.quote(asr_url.rstrip('/') + '/transcribe')} "
            "-H 'Content-Type: application/json' "
            f"--data-binary {shlex.quote(payload)}"
        )
        run(["ssh", ssh_host, remote_cmd], capture=True)
        raw = run(["ssh", ssh_host, "cat", remote_json], capture=True).stdout
        data = json.loads(raw)
        data["_remote_dir"] = remote_dir
        return data
    finally:
        if not keep_remote:
            run(["ssh", ssh_host, "rm", "-rf", remote_dir])


def http_transcribe(wav: Path, out_path: Path, *, asr_url: str, language: str) -> dict[str, Any]:
    payload = json.dumps(
        {"audio": str(wav.resolve()), "out": str(out_path.resolve()), "language": language, "engine": "parakeet"},
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        asr_url.rstrip("/") + "/transcribe",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        resp.read()
    return json.loads(out_path.read_text(encoding="utf-8"))


DDG_LINK = re.compile(
    r"<a[^>]*href=[\"'](?P<href>[^\"']+)[\"'][^>]*(?:class=[\"']result-link[\"']|rel=[\"']nofollow[\"'])[^>]*>"
    r"(?P<title>.*?)</a>",
    re.DOTALL,
)


def decode_ddg_href(href: str) -> str:
    href = html.unescape(href)
    parsed = urllib.parse.urlparse(href)
    qs = urllib.parse.parse_qs(parsed.query)
    if "uddg" in qs and qs["uddg"]:
        return qs["uddg"][0]
    return urllib.parse.urljoin("https://lite.duckduckgo.com", href)


def domain_of(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).netloc.lower()
    except ValueError:
        return ""


def ddg_search(query: str, *, limit: int = 8) -> list[dict[str, Any]]:
    url = "https://lite.duckduckgo.com/lite?" + urllib.parse.urlencode({"q": query})
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        page = resp.read().decode("utf-8", "replace")

    out: list[dict[str, Any]] = []
    for rank, match in enumerate(DDG_LINK.finditer(page), start=1):
        href = decode_ddg_href(match.group("href"))
        raw_title = html.unescape(re.sub(r"<[^>]+>", "", match.group("title")))
        cleaned = clean_text(raw_title)
        if not cleaned:
            continue
        out.append(
            {
                "rank": rank,
                "title": cleaned,
                "raw_title": raw_title,
                "url": href,
                "domain": domain_of(href),
            }
        )
        if len(out) >= limit:
            break
    return out


def ask_llm(results: list[dict[str, Any]], *, base_url: str, model: str) -> dict[str, Any]:
    search_str = "\n".join(r["title"] for r in results[:5] if r.get("title"))
    body = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Results:\n{search_str}"},
            ],
            "temperature": 0.0,
            "max_tokens": 128,
            "chat_template_kwargs": {"enable_thinking": False},
        },
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = json.loads(resp.read().decode("utf-8"))
    content = raw.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    parsed = None
    error = None
    try:
        parsed = parse_json_content(content)
    except Exception as exc:  # diagnostic path: keep the raw failure
        error = f"{type(exc).__name__}: {exc}"
    return {"content": content, "parsed": parsed, "error": error}


def add_unique(candidates: OrderedDict[tuple[str, str], dict], found: dict[str, Any] | None, source: str) -> None:
    if found:
        add_candidate(candidates, found.get("artist"), found.get("title"), source)


def build_candidates(meta: dict[str, Any], snippets_debug: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates: OrderedDict[tuple[str, str], dict] = OrderedDict()
    for c in title_candidates(meta.get("title") or meta.get("yt_title"), meta.get("uploader") or meta.get("channel")):
        add_unique(candidates, c, c.get("source", "metadata"))
    for item in snippets_debug:
        llm_parsed = (item.get("llm") or {}).get("parsed")
        add_unique(candidates, llm_parsed, "asr-search-llm")
        for parsed in item.get("parsed_result_titles") or []:
            add_unique(candidates, parsed, "asr-search-title")
    return list(candidates.values())


def diagnose_worker(args: argparse.Namespace) -> tuple[dict[str, Any], Path, bool]:
    require_tool("yt-dlp")
    require_tool("ffmpeg")

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid4().hex[:6]
    out_dir = Path(args.out_root) / run_id
    out_dir.mkdir(parents=True, exist_ok=True)

    timings: dict[str, float] = {}
    print(f"[diagnose] workdir: {out_dir}", flush=True)
    print("[diagnose] downloading audio...", flush=True)
    t0 = time.perf_counter()
    wav, meta = download_audio(args.url, out_dir)
    timings["download"] = round(time.perf_counter() - t0, 2)

    print("[diagnose] transcribing with warmed Parakeet...", flush=True)
    t_asr = time.perf_counter()
    lyrics_path = out_dir / "lyrics.json"
    asr = http_transcribe(wav, lyrics_path, asr_url=args.asr_url, language=args.language)
    asr_wall = round(time.perf_counter() - t_asr, 2)
    timings["asr_wall"] = asr_wall

    t_ident = time.perf_counter()
    snippets = asr_snippets(asr.get("words") or [])
    snippets_debug: list[dict[str, Any]] = []
    for idx, snippet in enumerate(snippets, start=1):
        query = f"lyrics {snippet}"
        print(f"[diagnose] DDG snippet {idx}/{len(snippets)}", flush=True)
        results = ddg_search(query)
        item: dict[str, Any] = {
            "index": idx,
            "snippet": snippet,
            "query": query,
            "ddg_results": results,
            "parsed_result_titles": [p for p in (parse_result_title(r["title"]) for r in results[:8]) if p],
        }
        if not args.no_llm and results:
            try:
                item["llm"] = ask_llm(results, base_url=args.llm_base_url, model=args.llm_model)
            except Exception as exc:
                item["llm"] = {"content": "", "parsed": None, "error": f"{type(exc).__name__}: {exc}"}
        snippets_debug.append(item)
    candidates = build_candidates(meta, snippets_debug)
    timings["identify"] = round(time.perf_counter() - t_ident, 2)

    t_lrc = time.perf_counter()
    pick_debug: dict[str, Any] = {"entry": None, "stats": None, "candidates": []}
    if candidates:
        picked = choose_lyrics(candidates, asr.get("words") or [], meta.get("duration") or asr.get("duration"))
        pick_debug = {
            "entry": picked.entry,
            "stats": picked.stats,
            "candidates": picked.candidates,
        }
    timings["lrclib"] = round(time.perf_counter() - t_lrc, 2)
    timings["total"] = round(sum(timings.values()), 2)

    report = {
        "url": args.url,
        "metadata": meta,
        "asr_summary": {
            "engine": asr.get("engine"),
            "model": asr.get("model"),
            "device": asr.get("device"),
            "duration": asr.get("duration"),
            "elapsed": asr.get("elapsed"),
            "wall_elapsed": asr_wall,
            "words": len(asr.get("words") or []),
            "text": asr.get("text"),
        },
        "timings_sec": timings,
        "snippets": snippets_debug,
        "candidates": candidates,
        "lrclib": pick_debug,
    }
    report_path = out_dir / "identify_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    media_removed = not args.keep_media
    if media_removed:
        for media_path in out_dir.glob("source.*"):
            if media_path.name != "source.info.json":
                media_path.unlink(missing_ok=True)
    return report, report_path, media_removed


def run_on_server(args: argparse.Namespace) -> int:
    require_tool("ssh")
    remote_args = [
        "python",
        "tools/diagnose_identify.py",
        "--worker-server",
        "--language",
        args.language,
        "--asr-url",
        args.server_asr_url,
        "--llm-base-url",
        args.server_llm_base_url,
        "--llm-model",
        args.llm_model,
        "--out-root",
        args.server_out_root,
    ]
    if args.no_llm:
        remote_args.append("--no-llm")
    if args.keep_media:
        remote_args.append("--keep-media")
    remote_args.append(args.url)

    remote_cmd = (
        f"cd {shlex.quote(args.server_project_dir)} && "
        "docker compose -f backend/docker-compose.yml exec -T api "
        + " ".join(shlex.quote(part) for part in remote_args)
    )
    return run(["ssh", args.ssh_host, remote_cmd]).returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Diagnose one URL through Parakeet ASR, DDG, optional LLM, LRCLib.")
    parser.add_argument("url")
    parser.add_argument("--language", default="ru")
    parser.add_argument("--ssh-host", default=os.environ.get("STEM_SSH_HOST", "evo"))
    parser.add_argument("--asr-url", default=os.environ.get("ASR_URL", "http://127.0.0.1:8091"))
    parser.add_argument(
        "--remote-root",
        default=os.environ.get("STEM_REMOTE_DIAG_ROOT", "/srv/apps/stem-practice-studio/diagnostics/tmp"),
        help="Server directory visible inside the ASR container; cleaned after the run unless --keep-remote.",
    )
    parser.add_argument("--llm-base-url", default=os.environ.get("LLM_BASE_URL", "http://evox2:8083/v1"))
    parser.add_argument("--llm-model", default=os.environ.get("LLM_MODEL", "qwen3.5-2b"))
    parser.add_argument("--no-llm", action="store_true")
    parser.add_argument("--local-download", action="store_true", help="Old local mode: download on Mac, then copy WAV to server.")
    parser.add_argument("--worker-server", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--server-project-dir", default="/srv/apps/stem-practice-studio")
    parser.add_argument("--server-out-root", default="/srv/apps/stem-practice-studio/diagnostics/identify")
    parser.add_argument("--server-asr-url", default="http://asr:8091")
    parser.add_argument("--server-llm-base-url", default="http://identify-llm:8083/v1")
    parser.add_argument("--keep-remote", action="store_true")
    parser.add_argument("--keep-media", action="store_true", help="Keep downloaded media/WAV in the local report dir.")
    parser.add_argument("--out-root", default=str(REPO_ROOT / "diagnostics" / "identify"))
    args = parser.parse_args()

    if args.worker_server:
        report, report_path, media_removed = diagnose_worker(args)
        print_summary(report, report_path, media_removed=media_removed)
        return 0

    if not args.local_download:
        return run_on_server(args)

    for tool in ("yt-dlp", "ffmpeg", "ssh", "scp"):
        require_tool(tool)

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid4().hex[:6]
    out_dir = Path(args.out_root) / run_id
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[diagnose] workdir: {out_dir}")
    print("[diagnose] downloading audio...")
    wav, meta = download_audio(args.url, out_dir)

    print("[diagnose] transcribing with warmed Parakeet on server...")
    t_asr = time.perf_counter()
    asr = remote_transcribe(
        wav,
        ssh_host=args.ssh_host,
        asr_url=args.asr_url,
        language=args.language,
        remote_root=args.remote_root,
        keep_remote=args.keep_remote,
    )
    asr_wall = round(time.perf_counter() - t_asr, 2)
    (out_dir / "lyrics.json").write_text(json.dumps(asr, ensure_ascii=False, indent=2), encoding="utf-8")

    snippets = asr_snippets(asr.get("words") or [])
    snippets_debug: list[dict[str, Any]] = []
    for idx, snippet in enumerate(snippets, start=1):
        query = f"lyrics {snippet}"
        print(f"[diagnose] DDG snippet {idx}/{len(snippets)}")
        results = ddg_search(query)
        item: dict[str, Any] = {
            "index": idx,
            "snippet": snippet,
            "query": query,
            "ddg_results": results,
            "parsed_result_titles": [p for p in (parse_result_title(r["title"]) for r in results[:8]) if p],
        }
        if not args.no_llm and results:
            try:
                item["llm"] = ask_llm(results, base_url=args.llm_base_url, model=args.llm_model)
            except Exception as exc:
                item["llm"] = {"content": "", "parsed": None, "error": f"{type(exc).__name__}: {exc}"}
        snippets_debug.append(item)

    candidates = build_candidates(meta, snippets_debug)
    pick_debug: dict[str, Any] = {"entry": None, "stats": None, "candidates": []}
    if candidates:
        picked = choose_lyrics(candidates, asr.get("words") or [], meta.get("duration") or asr.get("duration"))
        pick_debug = {
            "entry": picked.entry,
            "stats": picked.stats,
            "candidates": picked.candidates,
        }

    report = {
        "url": args.url,
        "metadata": meta,
        "asr_summary": {
            "engine": asr.get("engine"),
            "model": asr.get("model"),
            "device": asr.get("device"),
            "duration": asr.get("duration"),
            "elapsed": asr.get("elapsed"),
            "wall_elapsed": asr_wall,
            "words": len(asr.get("words") or []),
            "text": asr.get("text"),
        },
        "snippets": snippets_debug,
        "candidates": candidates,
        "lrclib": pick_debug,
    }
    report_path = out_dir / "identify_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if not args.keep_media:
        for media_path in out_dir.glob("source.*"):
            if media_path.name != "source.info.json":
                media_path.unlink(missing_ok=True)

    print_summary(report, report_path, media_removed=not args.keep_media)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
