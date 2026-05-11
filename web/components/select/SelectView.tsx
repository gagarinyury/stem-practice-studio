"use client";

import {
  IconArrowRight,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconTrash,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AlignedLyrics, AlignedWord, Manifest } from "@/lib/manifest";
import { fmtTime } from "@/lib/drill";
import { type Chunk, deleteChunk, listChunks, saveChunk } from "@/lib/chunks";
import { StemEngine } from "@/lib/audio-engine";
import { stemUrl } from "@/lib/manifest";
import { ScreenShell } from "@/components/ui/ScreenShell";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { BackLink } from "@/components/ui/BackLink";
import { Eyebrow } from "@/components/ui/text";
import { t } from "@/lib/strings";

interface Props {
  manifest: Manifest;
  aligned: AlignedLyrics;
}

interface Selection {
  anchor: number;
  focus: number;
  active: boolean;
}

const NULL_SEL: Selection = { anchor: -1, focus: -1, active: false };

export function SelectView({ manifest, aligned }: Props) {
  const router = useRouter();
  const linesData = useLinesData(aligned);

  const [sel, setSel] = useState<Selection>(NULL_SEL);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const engineRef = useRef<StemEngine | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const playAllRef = useRef<{ chunkIds: string[]; idx: number } | null>(null);

  useEffect(() => {
    const loaded = listChunks(manifest.id);
    setChunks(loaded);
    setHydrated(true);
    // Auto-activate the latest chunk as the current selection — so the
    // user can hit "drill" immediately on entry without re-selecting.
    if (loaded.length > 0) {
      const last = loaded[loaded.length - 1];
      if (typeof last.fromWordIdx === "number" && typeof last.toWordIdx === "number") {
        setSel({ anchor: last.fromWordIdx, focus: last.toWordIdx, active: true });
      }
    }
  }, [manifest.id]);

  async function ensureEngine(): Promise<StemEngine> {
    if (engineRef.current) return engineRef.current;
    const engine = new StemEngine();
    engineRef.current = engine;
    const stems = (Object.entries(manifest.stems) as [string, string][]).map(([key, rel]) => ({
      key,
      url: stemUrl(manifest.id, rel),
    }));
    await engine.load(stems);
    setAudioReady(true);
    return engine;
  }

  useEffect(() => () => engineRef.current?.dispose(), []);

  useEffect(() => {
    if (!activeChunkId) return;
    let raf = 0;
    const tick = () => {
      const e = engineRef.current;
      const cur = chunks.find((c) => c.id === activeChunkId);
      if (!e || !cur) return;
      if (e.currentTime >= cur.to - 0.05 && e.state === "playing") {
        const seq = playAllRef.current;
        if (seq) {
          seq.idx += 1;
          const nextId = seq.chunkIds[seq.idx];
          const nextChunk = chunks.find((c) => c.id === nextId);
          if (nextChunk) {
            e.setLoop(null);
            e.seek(nextChunk.from);
            e.setLoop({ from: nextChunk.from, to: nextChunk.to });
            setActiveChunkId(nextId);
          } else {
            playAllRef.current = null;
            e.pause();
            setActiveChunkId(null);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeChunkId, chunks]);

  async function playChunk(c: Chunk) {
    const e = await ensureEngine();
    if (activeChunkId === c.id && e.state === "playing") {
      e.pause();
      setActiveChunkId(null);
      playAllRef.current = null;
      return;
    }
    playAllRef.current = null;
    e.setLoop({ from: c.from, to: c.to });
    e.seek(c.from);
    e.play();
    setActiveChunkId(c.id);
  }

  const lo = sel.active ? Math.min(sel.anchor, sel.focus) : -1;
  const hi = sel.active ? Math.max(sel.anchor, sel.focus) : -1;
  const selectedWords =
    sel.active && lo >= 0 ? aligned.words.slice(lo, hi + 1) : [];

  const selFrom = selectedWords.length > 0 ? Math.min(...selectedWords.map((w) => w.start)) : 0;
  const selTo = selectedWords.length > 0 ? Math.max(...selectedWords.map((w) => w.end)) : 0;

  function wordIdxAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const node = (el as Element).closest("[data-word-idx]");
    if (!node) return null;
    const idx = Number.parseInt((node as HTMLElement).dataset.wordIdx ?? "", 10);
    return Number.isFinite(idx) ? idx : null;
  }

  function onPointerDown(e: React.PointerEvent) {
    const idx = wordIdxAt(e.clientX, e.clientY);
    if (idx == null) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setSel({ anchor: idx, focus: idx, active: true });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!sel.active) return;
    const idx = wordIdxAt(e.clientX, e.clientY);
    if (idx == null) return;
    if (idx !== sel.focus) setSel((s) => ({ ...s, focus: idx }));
  }

  function onPointerUp() {
    /* selection stays visible so user can press save/drill */
  }

  function clearSelection() {
    setSel(NULL_SEL);
  }

  function commitChunk() {
    if (selectedWords.length === 0) return;
    const label = selectedWords
      .slice(0, 6)
      .map((w) => w.word)
      .join(" ") + (selectedWords.length > 6 ? "…" : "");
    const c = saveChunk(manifest.id, {
      from: selFrom,
      to: selTo,
      fromWordIdx: lo,
      toWordIdx: hi,
      label,
    });
    setChunks((xs) => [...xs, c]);
    // Selection stays — so the user can immediately tap "drill" on the
    // phrase they just saved without re-selecting it.
  }

  function removeChunk(id: string) {
    deleteChunk(manifest.id, id);
    setChunks((xs) => xs.filter((c) => c.id !== id));
  }

  // If the current selection matches a saved chunk, pass its id along —
  // DrillView uses chunk id to enable ◄ ► navigation across all chunks.
  const matchedChunk = sel.active
    ? chunks.find((c) => c.fromWordIdx === lo && c.toWordIdx === hi)
    : undefined;
  const drillHref = sel.active
    ? matchedChunk
      ? `/drill/${manifest.id}?chunk=${matchedChunk.id}&from=${selFrom.toFixed(2)}&to=${selTo.toFixed(2)}`
      : `/drill/${manifest.id}?from=${selFrom.toFixed(2)}&to=${selTo.toFixed(2)}`
    : null;

  return (
    <ScreenShell variant="flow" compact>
      <div className="relative">
        <ScreenHeader
          eyebrow={t.select.eyebrow}
          title={t.select.titleA}
          emphasis={t.select.titleB}
        />
        <BackLink href={`/play/${manifest.id}`} />
      </div>

      {/* Scrollable lyrics with drag-selection. Side scrollbar visible. */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-y-auto pr-3 -mr-2 select-none cursor-pointer select-scroll"
        style={{ touchAction: "pan-y", userSelect: "none", WebkitUserSelect: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {!sel.active && chunks.length === 0 && (
          <div className="pb-3 font-mono text-[10px] text-[var(--color-accent-vocal)] tracking-[0.05em]">
            {t.select.hint}
          </div>
        )}
        {linesData.map((line, lineIdx) => (
          <div key={lineIdx} className="text-[19px] leading-[1.55] text-ink mb-1.5 italic">
            {line.empty ? (
              <span className="text-[var(--color-ink-faint)]">—</span>
            ) : (
              line.words.map((w, i) => {
                const inSel = sel.active && w.globalIdx >= lo && w.globalIdx <= hi;
                return (
                  <span
                    key={`${lineIdx}-${i}`}
                    data-word-idx={w.globalIdx}
                    className={`inline-block px-[3px] py-[1px] rounded-[3px] transition-colors ${
                      inSel
                        ? "bg-[var(--color-accent-vocal)] text-paper"
                        : "text-ink"
                    }`}
                    style={{ touchAction: "none" }}
                  >
                    {w.word}
                  </span>
                );
              })
            )}
          </div>
        ))}
      </div>

      {/* Saved chunks — compact, always visible if any */}
      {hydrated && chunks.length > 0 && (
        <div className="shrink-0 border-t border-[var(--color-border-soft)] pt-2.5">
          <div className="mb-2">
            <Eyebrow>— {t.select.myChunks} ({chunks.length})</Eyebrow>
          </div>
          <div
            className="overflow-y-auto pr-1 -mr-1 select-scroll"
            style={{ maxHeight: 110 }}
          >
            {chunks
              .slice()
              .sort((a, b) => a.from - b.from)
              .map((c) => {
                const isActive = activeChunkId === c.id;
                return (
                  <div
                    key={c.id}
                    className={`flex items-center gap-2 py-1.5 border-t border-[var(--color-border-soft)] first:border-t-0 ${
                      isActive ? "bg-[var(--color-surface-muted)] -mx-2 px-2 rounded-md" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => playChunk(c)}
                      className="w-6 h-6 flex items-center justify-center text-ink shrink-0"
                      title={isActive ? t.select.stop : t.select.previewTitle}
                    >
                      {isActive ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof c.fromWordIdx === "number" && typeof c.toWordIdx === "number") {
                          setSel({ anchor: c.fromWordIdx, focus: c.toWordIdx, active: true });
                        }
                      }}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-[14px] text-ink truncate font-serif italic leading-tight">{c.label}</div>
                      <div className="font-mono text-[10px] text-[var(--color-ink-muted)]">
                        {fmtTime(c.from)}–{fmtTime(c.to)} · {(c.to - c.from).toFixed(1)}s
                        {c.mastered ? ` · ${t.select.mastered}` : c.attempts > 0 ? ` · ${c.attempts}×` : ""}
                        {typeof c.bestScore === "number" && c.bestScore > 0 ? (
                          <span className="text-[var(--color-accent-vocal)]"> · {t.select.best} {Math.round(c.bestScore)}%</span>
                        ) : null}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeChunk(c.id)}
                      className="text-[var(--color-ink-faint)] hover:text-[var(--color-accent-warn)] shrink-0"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                );
              })}
          </div>
          {!audioReady && (
            <div className="pt-1.5 font-mono text-[9px] text-[var(--color-ink-muted)] text-center">
              {t.select.loadStemsHint}
            </div>
          )}
        </div>
      )}

      {/* Selection metadata (only when active). Above the action row. */}
      {sel.active && selectedWords.length > 0 && (
        <div className="shrink-0 flex items-baseline gap-3">
          <div className="font-mono text-[10px] text-[var(--color-ink-muted)] shrink-0">
            {selectedWords.length} {selectedWords.length === 1 ? t.select.word : t.select.words} · {(selTo - selFrom).toFixed(1)}s
          </div>
          <div className="flex-1 min-w-0 text-[12px] text-ink truncate font-serif italic">
            {selectedWords.map((w) => w.word).join(" ")}
          </div>
          <button
            type="button"
            onClick={clearSelection}
            className="font-mono text-[10px] text-[var(--color-ink-muted)] underline shrink-0"
          >
            {t.select.clear}
          </button>
        </div>
      )}

      {/* Always-visible action row directly above the BottomNav. */}
      <div className="shrink-0 flex items-center gap-2">
        <button
          type="button"
          onClick={commitChunk}
          disabled={!sel.active || selectedWords.length === 0}
          className="flex-1 bg-[var(--color-ink)] text-[var(--color-paper)] rounded-pill py-3 font-mono text-[12px] tracking-[0.05em] disabled:opacity-40"
        >
          {t.select.saveChunk}
        </button>
        <button
          type="button"
          onClick={() => {
            if (drillHref) router.push(drillHref);
          }}
          disabled={!drillHref}
          className="flex-1 bg-[var(--color-accent-vocal)] text-[var(--color-paper)] rounded-pill py-3 font-mono text-[12px] tracking-[0.05em] flex items-center justify-center gap-1.5 disabled:opacity-40"
        >
          {t.select.drill} <IconArrowRight size={14} />
        </button>
      </div>
    </ScreenShell>
  );
}

interface RenderedWord {
  globalIdx: number;
  word: string;
}
interface RenderedLine {
  empty: boolean;
  words: RenderedWord[];
}

function useLinesData(aligned: AlignedLyrics): RenderedLine[] {
  const lines = aligned.lines ?? [];
  const wordsByLine = new Map<number, { word: AlignedWord; globalIdx: number }[]>();
  aligned.words.forEach((w, i) => {
    if (!wordsByLine.has(w.line)) wordsByLine.set(w.line, []);
    wordsByLine.get(w.line)!.push({ word: w, globalIdx: i });
  });
  return lines.map((_text, lineIdx) => {
    const ws = wordsByLine.get(lineIdx) ?? [];
    return {
      empty: ws.length === 0,
      words: ws.map(({ word, globalIdx }) => ({ globalIdx, word: word.word })),
    };
  });
}
