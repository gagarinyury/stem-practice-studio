"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AlignedLyrics, AlignedWord } from "@/lib/manifest";

interface Props {
  aligned: AlignedLyrics;
  currentTime: number;
  selection: { from: number; to: number } | null;
  dragRange: { from: number; to: number } | null;
  onSelectWords: (fromIdx: number, toIdx: number) => void;
  onSeekWord: (w: AlignedWord) => void;
  onClearSelection: () => void;
}

interface DragState {
  anchor: number;
  focus: number;
}

export function LyricsPanel({
  aligned,
  currentTime,
  selection,
  dragRange,
  onSelectWords,
  onSeekWord,
  onClearSelection,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const pointerPos = useRef<{ x: number; y: number } | null>(null);
  const movedDuringDrag = useRef(false);

  const lines = useMemo(() => buildLines(aligned), [aligned]);

  // Active word index by currentTime
  const activeIdx = useMemo(() => {
    const w = aligned.words;
    if (!w.length) return -1;
    let lo = 0, hi = w.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (w[mid].start <= currentTime) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found >= 0 && currentTime > w[found].end + 0.5) {
      // gap — soften highlight
      if (found + 1 < w.length && currentTime < w[found + 1].start) return found;
    }
    return found;
  }, [aligned, currentTime]);

  // Autoscroll active word into view
  useEffect(() => {
    if (activeIdx < 0 || drag) return;
    const el = containerRef.current?.querySelector(
      `[data-word-idx="${activeIdx}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIdx, drag]);

  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    const edge = 72;
    const maxStep = 18;

    const tick = () => {
      const el = containerRef.current;
      const pos = pointerPos.current;
      if (el && pos) {
        const r = el.getBoundingClientRect();
        let step = 0;
        if (pos.y < r.top + edge) {
          step = -((r.top + edge - pos.y) / edge) * maxStep;
        } else if (pos.y > r.bottom - edge) {
          step = ((pos.y - (r.bottom - edge)) / edge) * maxStep;
        }

        if (step !== 0) {
          el.scrollTop += step;
          const idx = idxFromPoint(pos.x, pos.y);
          if (idx != null) {
            setDrag((d) => (d && d.focus !== idx ? { ...d, focus: idx } : d));
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drag]);

  function idxFromPoint(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const node = (el as Element).closest("[data-word-idx]");
    if (!node) return null;
    const i = Number.parseInt((node as HTMLElement).dataset.wordIdx ?? "", 10);
    return Number.isFinite(i) ? i : null;
  }

  function onPointerDown(e: React.PointerEvent) {
    const idx = idxFromPoint(e.clientX, e.clientY);
    if (idx == null) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (selection && (idx < selection.from || idx > selection.to)) {
      onClearSelection();
    }
    setDrag({ anchor: idx, focus: idx });
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    pointerPos.current = { x: e.clientX, y: e.clientY };
    movedDuringDrag.current = false;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    pointerPos.current = { x: e.clientX, y: e.clientY };
    const start = dragStartPos.current;
    if (start) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > 16) movedDuringDrag.current = true;
    }
    const idx = idxFromPoint(e.clientX, e.clientY);
    if (idx == null) return;
    if (idx !== drag.focus) setDrag((d) => (d ? { ...d, focus: idx } : null));
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!drag) return;
    const lo = Math.min(drag.anchor, drag.focus);
    const hi = Math.max(drag.anchor, drag.focus);

    if (!movedDuringDrag.current && lo === hi) {
      // click on single word — just seek
      const w = aligned.words[lo];
      if (w) onSeekWord(w);
    } else {
      onSelectWords(lo, hi);
    }
    setDrag(null);
    dragStartPos.current = null;
    pointerPos.current = null;
  }

  function onPointerCancel() {
    setDrag(null);
    dragStartPos.current = null;
    pointerPos.current = null;
  }

  const dragLo = drag ? Math.min(drag.anchor, drag.focus) : -1;
  const dragHi = drag ? Math.max(drag.anchor, drag.focus) : -1;

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto thin-scroll px-12 py-8 select-none"
      style={{ touchAction: "pan-y", userSelect: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="max-w-3xl mx-auto">
        {lines.map((line, li) => (
          <div key={li} className="text-[22px] leading-[1.55] font-serif italic mb-1.5">
            {line.empty ? (
              <span className="text-[var(--color-ink-faint)]">—</span>
            ) : (
              line.words.map((w, i) => {
                const inDrag = drag && w.globalIdx >= dragLo && w.globalIdx <= dragHi;
                const inSel =
                  !drag &&
                  selection &&
                  w.globalIdx >= selection.from &&
                  w.globalIdx <= selection.to;
                const inDragRange =
                  dragRange &&
                  w.wordObj.start < dragRange.to &&
                  w.wordObj.end > dragRange.from;
                const isActive = w.globalIdx === activeIdx;
                const isHighlighted = !!(inDrag || inSel || inDragRange);

                let wrapperCls = "transition-colors";
                if (inDrag || inSel) wrapperCls += " bg-[var(--color-accent-vocal-100)]";
                else if (inDragRange) wrapperCls += " bg-[var(--color-accent-vocal-50)]";

                let textCls = "text-ink";
                if (inDrag || inSel) textCls = "text-[var(--color-accent-vocal-700)]";
                else if (inDragRange) textCls = "text-[var(--color-accent-vocal-700)]";
                if (isActive) textCls = "text-[var(--color-accent-vocal)] font-bold drop-shadow-[0_0_8px_rgba(163,113,247,0.4)]";

                return (
                  <span key={`${li}-${i}`} className={wrapperCls}>
                    <span
                      data-word-idx={w.globalIdx}
                      className={`inline-block px-[1px] py-[2px] transition-all cursor-pointer ${isHighlighted ? "" : "hover:bg-[var(--color-surface-muted)] hover:rounded"} ${textCls}`}
                      style={{ touchAction: "none" }}
                    >
                      {w.word}
                    </span>
                    {i < line.words.length - 1 && " "}
                  </span>
                );
              })
            )}
          </div>
        ))}
        {lines.length === 0 && (
          <div className="font-mono text-[12px] text-[var(--color-ink-muted)]">
            нет lyrics для этого трека
          </div>
        )}
      </div>
    </div>
  );
}

interface RenderedWord {
  globalIdx: number;
  word: string;
  wordObj: AlignedWord;
}
interface RenderedLine {
  empty: boolean;
  words: RenderedWord[];
}

function buildLines(aligned: AlignedLyrics): RenderedLine[] {
  const lines = aligned.lines ?? [];
  const wordsByLine = new Map<number, { word: AlignedWord; globalIdx: number }[]>();
  aligned.words.forEach((w, i) => {
    if (!wordsByLine.has(w.line)) wordsByLine.set(w.line, []);
    wordsByLine.get(w.line)!.push({ word: w, globalIdx: i });
  });
  return lines.map((_, lineIdx) => {
    const ws = wordsByLine.get(lineIdx) ?? [];
    return {
      empty: ws.length === 0,
      words: ws.map(({ word, globalIdx }) => ({ globalIdx, word: word.word, wordObj: word })),
    };
  });
}
