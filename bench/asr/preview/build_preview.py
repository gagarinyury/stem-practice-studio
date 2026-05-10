"""Generate self-contained karaoke preview HTML for a track folder.

Each subfolder under preview/ should contain:
    - lyrics.json (Parakeet/GigaAM output schema)
    - vocals.flac (vocal stem, played by the preview)

Output: <folder>/karaoke.html — open directly in browser, no server needed.
The lyrics JSON is embedded inline so file:// loads work without CORS issues.
"""
import json
import sys
from pathlib import Path

HTML_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Karaoke preview — {audio_name}</title>
<style>
  :root {{
    --paper: #FAF7F2;
    --ink: #1a1410;
    --ink-soft: #1a141066;
    --accent: #534AB7;
    --accent-soft: #534AB71a;
  }}
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; padding: 0; background: var(--paper); color: var(--ink); }}
  body {{
    font-family: 'DM Mono', ui-monospace, monospace;
    min-height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 24px;
    padding: 32px;
  }}
  header h1 {{
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-weight: 500;
    font-size: 28px;
    margin: 0 0 6px 0;
  }}
  header .meta {{ font-size: 12px; color: var(--ink-soft); }}
  main {{
    overflow-y: auto;
    line-height: 2.4;
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 28px;
    padding: 0 8px 200px;
  }}
  .word {{
    display: inline;
    padding: 0 2px;
    border-radius: 3px;
    transition: background 80ms linear, color 80ms linear;
    color: var(--ink-soft);
  }}
  .word.passed {{ color: var(--ink); }}
  .word.current {{
    background: var(--accent);
    color: var(--paper);
    padding: 2px 6px;
    border-radius: 4px;
  }}
  footer {{
    position: sticky;
    bottom: 0;
    background: var(--paper);
    border-top: 1px solid var(--ink-soft);
    padding-top: 16px;
  }}
  audio {{ width: 100%; }}
  .stats {{
    margin-top: 8px;
    font-size: 11px;
    color: var(--ink-soft);
    display: flex;
    gap: 18px;
  }}
</style>
</head>
<body>
<header>
  <h1>{title}</h1>
  <div class="meta">{model} · {duration:.1f}s · {n_words} words · RTF {rtf:.3f}</div>
</header>
<main id="lyrics"></main>
<footer>
  <audio id="audio" src="{audio_name}" controls preload="auto"></audio>
  <div class="stats">
    <span id="time">0.00s</span>
    <span id="word-info">—</span>
  </div>
</footer>
<script>
  const LYRICS = {lyrics_json};
  const audio = document.getElementById('audio');
  const lyricsEl = document.getElementById('lyrics');
  const timeEl = document.getElementById('time');
  const infoEl = document.getElementById('word-info');

  const spans = LYRICS.words.map((w, i) => {{
    const span = document.createElement('span');
    span.className = 'word';
    span.textContent = w.word + ' ';
    span.dataset.start = w.start;
    span.dataset.end = w.end;
    span.dataset.idx = i;
    span.addEventListener('click', () => {{ audio.currentTime = w.start; audio.play(); }});
    lyricsEl.appendChild(span);
    return span;
  }});

  let currentIdx = -1;
  function tick() {{
    const t = audio.currentTime;
    timeEl.textContent = t.toFixed(2) + 's';

    let idx = -1;
    for (let i = 0; i < LYRICS.words.length; i++) {{
      const w = LYRICS.words[i];
      if (t >= w.start && t < w.end) {{ idx = i; break; }}
      if (t < w.start) {{ break; }}
    }}

    if (idx !== currentIdx) {{
      if (currentIdx >= 0) spans[currentIdx].classList.remove('current');
      currentIdx = idx;
      if (idx >= 0) {{
        spans[idx].classList.add('current');
        spans[idx].scrollIntoView({{ behavior: 'smooth', block: 'center' }});
        infoEl.textContent = `[${{LYRICS.words[idx].start.toFixed(2)}} – ${{LYRICS.words[idx].end.toFixed(2)}}] ${{LYRICS.words[idx].word}}`;
      }} else {{
        infoEl.textContent = '—';
      }}
      // Mark passed words
      for (let i = 0; i < spans.length; i++) {{
        spans[i].classList.toggle('passed', LYRICS.words[i].end <= t);
      }}
    }}
    requestAnimationFrame(tick);
  }}
  requestAnimationFrame(tick);
</script>
</body>
</html>
"""


def build(folder: Path, title: str) -> Path:
    lyrics = json.loads((folder / "lyrics.json").read_text())
    audio_name = "vocals.flac"
    if not (folder / audio_name).exists():
        raise SystemExit(f"missing {folder / audio_name}")

    html = HTML_TEMPLATE.format(
        audio_name=audio_name,
        title=title,
        model=lyrics.get("model", "unknown"),
        duration=lyrics.get("duration", 0.0),
        n_words=len(lyrics.get("words", [])),
        rtf=lyrics.get("rtf", 0.0),
        lyrics_json=json.dumps(lyrics, ensure_ascii=False),
    )
    out = folder / "karaoke.html"
    out.write_text(html)
    return out


if __name__ == "__main__":
    here = Path(__file__).parent
    targets = [
        (here / "8LL0TgWmvaE", "Калинов Мост — Время колокольчиков (RU · GigaAM v3)"),
        (here / "MwpMEbgC7DA", "Tom Odell — Another Love (EN · Parakeet-TDT v3)"),
    ]
    for folder, title in targets:
        if not folder.exists():
            print(f"skip {folder}: not found", file=sys.stderr)
            continue
        out = build(folder, title)
        print(f"wrote {out}")
