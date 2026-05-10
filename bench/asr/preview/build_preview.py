"""Generate self-contained karaoke preview HTML for a track folder.

Each subfolder under preview/ should contain:
    - vocals.flac
    - lyrics.json (raw ASR), and optionally
    - lyrics_aligned.json (LRC text aligned to ASR timings via NW alignment)

If lyrics_aligned.json exists we use it (clean text, line breaks). Otherwise
we fall back to the raw ASR words. Lyrics JSON is embedded inline so the
HTML opens via file:// without CORS issues.
"""
import json
import sys
from pathlib import Path

HTML_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Karaoke preview — {title}</title>
<style>
  :root {{
    --paper: #FAF7F2;
    --ink: #1a1410;
    --ink-soft: #1a141066;
    --ink-faint: #1a141033;
    --accent: #534AB7;
    --accent-soft: #534AB71a;
    --warn: #C66857;
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
    padding: 0 8px 200px;
  }}
  .line {{
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 26px;
    line-height: 1.7;
    margin: 0 0 4px 0;
    color: var(--ink-faint);
    transition: color 200ms;
  }}
  .line.active {{ color: var(--ink); }}
  .word {{
    display: inline;
    padding: 0 2px;
    border-radius: 3px;
    cursor: pointer;
  }}
  .word.passed {{ color: var(--ink); }}
  .word.current {{
    background: var(--accent);
    color: var(--paper);
    padding: 2px 6px;
    border-radius: 4px;
  }}
  .word.interp {{ border-bottom: 1px dashed var(--warn); }}
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
    flex-wrap: wrap;
  }}
  .stats .warn {{ color: var(--warn); }}
</style>
</head>
<body>
<header>
  <h1>{title}</h1>
  <div class="meta">{meta_line}</div>
</header>
<main id="lyrics"></main>
<footer>
  <audio id="audio" src="{audio_name}" controls preload="auto"></audio>
  <div class="stats">
    <span id="time">0.00s</span>
    <span id="word-info">—</span>
    <span class="warn">— dashed underline = interpolated timing —</span>
  </div>
</footer>
<script>
  const LYRICS = {lyrics_json};
  const audio = document.getElementById('audio');
  const lyricsEl = document.getElementById('lyrics');
  const timeEl = document.getElementById('time');
  const infoEl = document.getElementById('word-info');

  const useLines = Array.isArray(LYRICS.lines) && LYRICS.words[0] && LYRICS.words[0].line !== undefined;

  const wordSpans = [];
  const lineEls = [];

  if (useLines) {{
    const grouped = {{}};
    for (const w of LYRICS.words) {{
      (grouped[w.line] ||= []).push(w);
    }}
    for (let li = 0; li < LYRICS.lines.length; li++) {{
      const lineEl = document.createElement('p');
      lineEl.className = 'line';
      lineEl.dataset.idx = li;
      lineEls.push(lineEl);
      for (const w of (grouped[li] || [])) {{
        const span = document.createElement('span');
        span.className = 'word' + (w.match === 'interp' ? ' interp' : '');
        span.textContent = w.word + ' ';
        span.dataset.start = w.start;
        span.dataset.end = w.end;
        span.dataset.idx = wordSpans.length;
        span.dataset.line = li;
        span.addEventListener('click', () => {{ audio.currentTime = w.start; audio.play(); }});
        lineEl.appendChild(span);
        wordSpans.push({{ span, w }});
      }}
      lyricsEl.appendChild(lineEl);
    }}
  }} else {{
    for (const w of LYRICS.words) {{
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = w.word + ' ';
      span.dataset.start = w.start;
      span.dataset.end = w.end;
      span.addEventListener('click', () => {{ audio.currentTime = w.start; audio.play(); }});
      lyricsEl.appendChild(span);
      wordSpans.push({{ span, w }});
    }}
  }}

  let currentIdx = -1;
  let currentLine = -1;
  function tick() {{
    const t = audio.currentTime;
    timeEl.textContent = t.toFixed(2) + 's';

    let idx = -1;
    for (let i = 0; i < wordSpans.length; i++) {{
      const w = wordSpans[i].w;
      if (t >= w.start && t < w.end) {{ idx = i; break; }}
      if (t < w.start) {{ break; }}
    }}

    if (idx !== currentIdx) {{
      if (currentIdx >= 0) wordSpans[currentIdx].span.classList.remove('current');
      currentIdx = idx;
      if (idx >= 0) {{
        const {{ span, w }} = wordSpans[idx];
        span.classList.add('current');
        span.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
        infoEl.textContent = `[${{w.start.toFixed(2)}} – ${{w.end.toFixed(2)}}] ${{w.word}}`;

        if (useLines && w.line !== currentLine) {{
          if (currentLine >= 0) lineEls[currentLine]?.classList.remove('active');
          currentLine = w.line;
          lineEls[currentLine]?.classList.add('active');
        }}
      }} else {{
        infoEl.textContent = '—';
      }}
      // Mark passed words
      for (let i = 0; i < wordSpans.length; i++) {{
        wordSpans[i].span.classList.toggle('passed', wordSpans[i].w.end <= t);
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
    aligned_path = folder / "lyrics_aligned.json"
    raw_path = folder / "lyrics.json"
    if aligned_path.exists():
        lyrics = json.loads(aligned_path.read_text())
        align = lyrics.get("alignment", {})
        meta_line = (
            f"{lyrics.get('engine')} · {lyrics.get('duration', 0):.1f}s · "
            f"{align.get('matched', '?')}/{align.get('lrc_words', '?')} matched "
            f"({align.get('match_rate', 0)*100:.0f}%) · "
            f"{align.get('interpolated', 0)} interpolated · "
            f"text from LRCLib ({lyrics.get('lrc_source', {}).get('artist')})"
        )
    else:
        lyrics = json.loads(raw_path.read_text())
        meta_line = (
            f"{lyrics.get('model')} · {lyrics.get('duration', 0):.1f}s · "
            f"{len(lyrics.get('words', []))} words · RTF {lyrics.get('rtf', 0):.3f}"
        )

    if not (folder / "vocals.flac").exists():
        raise SystemExit(f"missing {folder/'vocals.flac'}")

    html = HTML_TEMPLATE.format(
        audio_name="vocals.flac",
        title=title,
        meta_line=meta_line,
        lyrics_json=json.dumps(lyrics, ensure_ascii=False),
    )
    out = folder / "karaoke.html"
    out.write_text(html, encoding="utf-8")
    return out


if __name__ == "__main__":
    here = Path(__file__).parent
    targets = [
        (here / "8LL0TgWmvaE", "Калинов Мост — Время колокольчиков (LRC text · GigaAM timings)"),
        (here / "MwpMEbgC7DA", "Tom Odell — Another Love (LRC text · Parakeet timings)"),
    ]
    for folder, title in targets:
        if not folder.exists():
            print(f"skip {folder}: not found", file=sys.stderr)
            continue
        out = build(folder, title)
        print(f"wrote {out}")
