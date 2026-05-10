"use client";

import {
  IconArrowRight,
  IconCheck,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AlignedLyrics, AlignedWord, Manifest } from "@/lib/manifest";
import { fmtTime } from "@/lib/drill";
import { type Chunk, deleteChunk, listChunks, saveChunk } from "@/lib/chunks";
import { StemEngine } from "@/lib/audio-engine";
import { stemUrl } from "@/lib/manifest";

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
  // Words organised by line for rendering, but we keep the global word index
  // (position in aligned.words) as the selection anchor — that's the unit we
  // persist as a chunk.
  const linesData = useLinesData(aligned);

  const [sel, setSel] = useState<Selection>(NULL_SEL);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Engine for in-place chunk preview / play-all sequence.
  const engineRef = useRef<StemEngine | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const playAllRef = useRef<{ chunkIds: string[]; idx: number } | null>(null);

  useEffect(() => {
    setChunks(listChunks(manifest.id));
    setHydrated(true);
  }, [manifest.id]);

  // Lazy-load engine the first time the user hits play.
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

  // Watch the currently-playing chunk and advance the play-all sequence at boundary.
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
            // Sequence complete.
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

  async function playAll() {
    if (chunks.length === 0) return;
    const e = await ensureEngine();
    if (playAllRef.current) {
      e.pause();
      playAllRef.current = null;
      setActiveChunkId(null);
      return;
    }
    const seq = chunks.slice().sort((a, b) => a.from - b.from).map((c) => c.id);
    playAllRef.current = { chunkIds: seq, idx: 0 };
    const first = chunks.find((c) => c.id === seq[0])!;
    e.setLoop({ from: first.from, to: first.to });
    e.seek(first.from);
    e.play();
    setActiveChunkId(first.id);
  }

  const lo = sel.active ? Math.min(sel.anchor, sel.focus) : -1;
  const hi = sel.active ? Math.max(sel.anchor, sel.focus) : -1;
  const selectedWords =
    sel.active && lo >= 0 ? aligned.words.slice(lo, hi + 1) : [];

  const selFrom = selectedWords.length > 0 ? Math.min(...selectedWords.map((w) => w.start)) : 0;
  const selTo = selectedWords.length > 0 ? Math.max(...selectedWords.map((w) => w.end)) : 0;

  /** Translate a pointer coordinate to the word index under it. */
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
    // Selection stays visible after pointer-up so the user can press "drill".
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
    clearSelection();
  }

  function removeChunk(id: string) {
    deleteChunk(manifest.id, id);
    setChunks((xs) => xs.filter((c) => c.id !== id));
  }

  return (
    <div className="bg-paper rounded-[28px] border border-[var(--color-border-soft)] overflow-hidden font-serif w-[min(560px,100%)] flex flex-col">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-[var(--color-border-soft)]">
        <Link href={`/play/${manifest.id}`} className="text-ink">
          <IconX size={22} />
        </Link>
        <div className="text-center">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-accent-plan)]">
            — pick what to learn —
          </div>
          <div className="text-[18px] text-ink leading-none mt-1 truncate max-w-[300px]">
            {manifest.title}
          </div>
        </div>
        <div className="w-[22px]" />
      </div>

      {/* Hint about drag selection — fades after first use */}
      {!sel.active && chunks.length === 0 && (
        <div className="px-6 pt-4 pb-1 font-mono text-[10px] text-[var(--color-accent-vocal)] tracking-[0.05em] flex items-center gap-2">
          <span className="inline-block w-4 h-px bg-[var(--color-accent-vocal)]" />
          tap & drag across words to pick a phrase to drill
          <span className="inline-block flex-1 h-px bg-[var(--color-accent-vocal)] opacity-30" />
        </div>
      )}

      {/* Lyrics with drag selection */}
      <div
        ref={containerRef}
        className="px-6 py-6 select-none cursor-pointer"
        style={{ touchAction: "pan-y", userSelect: "none", WebkitUserSelect: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {linesData.map((line, lineIdx) => (
          <div key={lineIdx} className="text-[20px] leading-[1.6] text-ink mb-1.5 italic">
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

      {/* Selection toolbar */}
      {sel.active && selectedWords.length > 0 && (
        <div className="border-t border-[var(--color-border-soft)] bg-white px-5 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[10px] text-[var(--color-ink-muted)] tracking-[0.05em]">
              {selectedWords.length} {selectedWords.length === 1 ? "word" : "words"} ·
              {" "}{(selTo - selFrom).toFixed(1)}s · {fmtTime(selFrom)}–{fmtTime(selTo)}
            </div>
            <div className="text-[14px] text-ink truncate font-serif italic">
              {selectedWords.map((w) => w.word).join(" ")}
            </div>
          </div>
          <button
            type="button"
            onClick={clearSelection}
            className="font-mono text-[11px] text-[var(--color-ink-muted)] underline"
          >
            clear
          </button>
          <Link
            href={`/drill/${manifest.id}?from=${selFrom.toFixed(2)}&to=${selTo.toFixed(2)}`}
            className="bg-[var(--color-accent-vocal)] text-paper rounded-[var(--radius-pill)] px-4 py-2 font-mono text-[11px] tracking-[0.05em] flex items-center gap-1.5"
          >
            drill <IconArrowRight size={14} />
          </Link>
          <button
            type="button"
            onClick={commitChunk}
            className="bg-ink text-paper rounded-[var(--radius-pill)] px-4 py-2 font-mono text-[11px] tracking-[0.05em]"
          >
            save chunk
          </button>
        </div>
      )}

      {/* Saved chunks */}
      {hydrated && chunks.length > 0 && (
        <div className="border-t border-[var(--color-border-soft)] px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)]">
              — my chunks ({chunks.length})
            </div>
            <button
              type="button"
              onClick={playAll}
              className="bg-ink text-paper rounded-[var(--radius-pill)] px-3 py-1 font-mono text-[10px] tracking-[0.05em] flex items-center gap-1.5"
            >
              {playAllRef.current ? (
                <>
                  <IconPlayerPauseFilled size={12} /> stop
                </>
              ) : (
                <>
                  <IconPlayerPlayFilled size={12} /> play all
                </>
              )}
            </button>
          </div>
          {chunks
            .slice()
            .sort((a, b) => a.from - b.from)
            .map((c) => {
              const isActive = activeChunkId === c.id;
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-3 py-2.5 border-t border-[var(--color-border-soft)] ${
                    isActive ? "bg-[var(--color-surface-muted)] -mx-5 px-5" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => playChunk(c)}
                    className="w-7 h-7 flex items-center justify-center text-ink"
                    title={isActive ? "stop" : "preview"}
                  >
                    {isActive ? (
                      <IconPlayerPauseFilled size={16} />
                    ) : (
                      <IconPlayerPlayFilled size={16} />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] text-ink truncate font-serif italic">{c.label}</div>
                    <div className="font-mono text-[10px] text-[var(--color-ink-muted)]">
                      {fmtTime(c.from)}–{fmtTime(c.to)} · {(c.to - c.from).toFixed(1)}s
                      {c.mastered ? " · ✓ mastered" : c.attempts > 0 ? ` · ${c.attempts}×` : ""}
                      {typeof c.bestScore === "number" && c.bestScore > 0 ? (
                        <span className="text-[var(--color-accent-vocal)]"> · best {Math.round(c.bestScore)}%</span>
                      ) : null}
                    </div>
                  </div>
                  <Link
                    href={`/drill/${manifest.id}?chunk=${c.id}&from=${c.from.toFixed(2)}&to=${c.to.toFixed(2)}`}
                    className="font-mono text-[11px] text-[var(--color-accent-vocal)] px-2 py-1"
                  >
                    drill →
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeChunk(c.id)}
                    className="text-[var(--color-ink-faint)] hover:text-[var(--color-accent-warn)]"
                  >
                    <IconTrash size={16} />
                  </button>
                </div>
              );
            })}
        </div>
      )}

      {!audioReady && hydrated && chunks.length > 0 && (
        <div className="px-5 pb-3 font-mono text-[9px] text-[var(--color-ink-muted)] text-center">
          tap ▶ to load stems for preview
        </div>
      )}
    </div>
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
