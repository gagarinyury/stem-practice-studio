"use client";

import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconMicrophone,
  IconMinus,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlignedLyrics, Manifest } from "@/lib/manifest";
import { pickPhrase, fmtTime, type Phrase } from "@/lib/drill";
import { stemUrl } from "@/lib/manifest";
import { StemEngine } from "@/lib/audio-engine";
import { type Chunk, listChunks, updateChunk } from "@/lib/chunks";
import { LyricsReel } from "./LyricsReel";

interface Props {
  manifest: Manifest;
  aligned: AlignedLyrics;
  initialLineIndex?: number;
  initialFromSec?: number;
  initialToSec?: number;
  initialPre?: number;
  initialPost?: number;
  initialChunkId?: string;
}

const BUCKETS = 53;
const VIEW_W = 320;
const VIEW_H = 56;
const CENTER_Y = 28;

const TEMPO_STEP = 0.05;
const TEMPO_MIN = 0.5;
const TEMPO_MAX = 1.2;

const PITCH_STEP = 1; // semitones
const PITCH_MIN = -6;
const PITCH_MAX = 6;

const PAD_STEP = 0.25; // seconds
const PAD_MIN = 0;
const PAD_MAX = 4;

/** Hit area around an A/B marker (px in SVG coords). */
const MARKER_HIT = 12;

export function DrillView({
  manifest,
  aligned,
  initialLineIndex,
  initialFromSec,
  initialToSec,
  initialPre = 0,
  initialPost = 0,
  initialChunkId,
}: Props) {
  // Hydrate chunks from localStorage. We may switch the active phrase
  // when the user navigates ◄ ►.
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setChunks(listChunks(manifest.id));
    setHydrated(true);
  }, [manifest.id]);

  const [chunkId, setChunkId] = useState<string | undefined>(initialChunkId);

  // Resolve current chunk (if any) from the hydrated list.
  const currentChunk = useMemo(() => {
    if (!chunkId) return null;
    return chunks.find((c) => c.id === chunkId) ?? null;
  }, [chunkId, chunks]);

  const sortedChunks = useMemo(
    () => chunks.slice().sort((a, b) => a.from - b.from),
    [chunks],
  );
  const chunkIdx = currentChunk
    ? sortedChunks.findIndex((c) => c.id === currentChunk.id)
    : -1;

  // Phrase derived from current chunk (if any) or initial url params.
  const phrase = useMemo<Phrase | null>(() => {
    if (currentChunk) {
      return pickPhrase(aligned, {
        fromSec: currentChunk.from,
        toSec: currentChunk.to,
      });
    }
    return pickPhrase(aligned, {
      fromSec: initialFromSec,
      toSec: initialToSec,
      lineIndex: initialLineIndex,
    });
  }, [aligned, currentChunk, initialLineIndex, initialFromSec, initialToSec]);

  const navigate = useCallback(
    (chunk: Chunk) => {
      setChunkId(chunk.id);
      // Update URL without re-rendering the server tree.
      if (typeof window !== "undefined") {
        const u = new URL(window.location.href);
        u.searchParams.set("chunk", chunk.id);
        u.searchParams.set("from", chunk.from.toFixed(2));
        u.searchParams.set("to", chunk.to.toFixed(2));
        u.searchParams.delete("line");
        window.history.replaceState(null, "", u.toString());
      }
    },
    [],
  );

  if (!phrase) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-muted font-mono text-[12px]">
        no phrase to drill — track has no aligned lyrics
      </div>
    );
  }

  return (
    <DrillInner
      manifest={manifest}
      aligned={aligned}
      phrase={phrase}
      initialPre={initialPre}
      initialPost={initialPost}
      hydrated={hydrated}
      sortedChunks={sortedChunks}
      chunkIdx={chunkIdx}
      currentChunkId={currentChunk?.id ?? null}
      mastered={currentChunk?.mastered ?? false}
      onNavigate={navigate}
      onChunksChanged={() => setChunks(listChunks(manifest.id))}
    />
  );
}

function DrillInner({
  manifest,
  aligned,
  phrase,
  initialPre,
  initialPost,
  hydrated,
  sortedChunks,
  chunkIdx,
  currentChunkId,
  mastered,
  onNavigate,
  onChunksChanged,
}: {
  manifest: Manifest;
  aligned: AlignedLyrics;
  phrase: Phrase;
  initialPre: number;
  initialPost: number;
  hydrated: boolean;
  sortedChunks: Chunk[];
  chunkIdx: number;
  currentChunkId: string | null;
  mastered: boolean;
  onNavigate: (c: Chunk) => void;
  onChunksChanged: () => void;
}) {
  // Controls.
  const [tempo, setTempo] = useState(1.0);
  const [pitch, setPitch] = useState(0);
  const [mode, setMode] = useState<"acappella" | "with" | "minus">("with");
  const [pre, setPre] = useState(initialPre);
  const [post, setPost] = useState(initialPost);
  const [repeats, setRepeats] = useState(0);

  // Drag-handle drafts: when set, override `pre`/`post` for visual marker
  // position only (no regen). Committed to real state on pointerup.
  const [draftPre, setDraftPre] = useState<number | null>(null);
  const [draftPost, setDraftPost] = useState<number | null>(null);

  // Reset chunk-scoped state when phrase changes (chunk nav).
  useEffect(() => {
    setRepeats(0);
    setPre(initialPre);
    setPost(initialPost);
    setDraftPre(null);
    setDraftPost(null);
    // intentionally only react to phrase boundary changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phrase.from, phrase.to]);

  // Effective loop = phrase ± padding, clamped to track duration.
  const trackDur = manifest.duration ?? phrase.to + 5;
  const effFrom = Math.max(0, phrase.from - pre);
  const effTo = Math.min(trackDur, phrase.to + post);

  // Visual loop (uses drafts during drag, falls back to real values).
  const visPre = draftPre ?? pre;
  const visPost = draftPost ?? post;
  const visEffFrom = Math.max(0, phrase.from - visPre);
  const visEffTo = Math.min(trackDur, phrase.to + visPost);

  // Zoom window: widened to fit max possible drag so markers stay on screen.
  // PAD_MAX is the max padding the user can select, so window covers it fully.
  const winFrom = Math.max(0, phrase.from - PAD_MAX - 0.3);
  const winTo = Math.min(trackDur, phrase.to + PAD_MAX + 0.3);
  const winLen = Math.max(0.001, winTo - winFrom);

  const ax = ((visEffFrom - winFrom) / winLen) * VIEW_W;
  const bx = ((visEffTo - winFrom) / winLen) * VIEW_W;

  // Engine state.
  const engineRef = useRef<StemEngine | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(effFrom);

  // Load engine once.
  useEffect(() => {
    let cancelled = false;
    const engine = new StemEngine();
    engineRef.current = engine;
    engine.onStateChange = (s) => setPlaying(s === "playing");
    const stems = (Object.entries(manifest.stems) as [string, string][]).map(([key, rel]) => ({
      key,
      url: stemUrl(manifest.id, rel),
    }));
    engine
      .load(stems)
      .then(() => {
        if (cancelled) return;
        engine.setLoop({ from: effFrom, to: effTo });
        engine.seek(effFrom);
        setAudioReady(true);
      })
      .catch(() => {
        /* loading failed */
      });
    return () => {
      cancelled = true;
      engine.dispose();
    };
    // We intentionally only depend on manifest.id — not on padding.
    // Padding changes adjust the loop via setLoop in another effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest.id]);

  // Recompute zoom-slice peaks when the visible window changes.
  useEffect(() => {
    if (!audioReady || !engineRef.current) return;
    const range = engineRef.current.getPeaksRange(BUCKETS, winFrom, winTo);
    const merged = new Float32Array(BUCKETS);
    for (let i = 0; i < BUCKETS; i++) merged[i] = (range.left[i] + range.right[i]) * 0.5;
    setPeaks(merged);
  }, [winFrom, winTo, audioReady]);

  // Apply tempo / pitch / loop range via rubberband. Debounced.
  const [processing, setProcessing] = useState(false);
  useEffect(() => {
    if (!audioReady) return;
    const handle = setTimeout(async () => {
      const e = engineRef.current;
      if (!e) return;
      const timeRatio = 1 / tempo;
      const pitchScale = Math.pow(2, pitch / 12);
      setProcessing(true);
      try {
        await e.setTimePitch(timeRatio, pitchScale, { from: effFrom, to: effTo });
      } finally {
        setProcessing(false);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [tempo, pitch, effFrom, effTo, audioReady]);

  // Practice mode.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !audioReady) return;
    const stemKeys = Object.keys(manifest.stems);
    if (mode === "acappella") {
      engine.setSolo("vocals");
    } else if (mode === "minus") {
      engine.setSolo(null);
      for (const k of stemKeys) engine.setMuted(k, k === "vocals");
    } else {
      engine.setSolo(null);
      for (const k of stemKeys) engine.setMuted(k, false);
    }
  }, [mode, audioReady, manifest.stems]);

  // RAF: playhead + loop wrap counter (also bumps `attempts` on chunk).
  const lastTimeRef = useRef(effFrom);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const e = engineRef.current;
      if (e) {
        const t = e.currentTime;
        setCurrentTime(t);
        const len = effTo - effFrom;
        if (len > 0.1 && lastTimeRef.current > t + len * 0.5) {
          setRepeats((r) => r + 1);
          if (currentChunkId) {
            const cur = listChunks(manifest.id).find((c) => c.id === currentChunkId);
            if (cur) {
              updateChunk(manifest.id, currentChunkId, { attempts: cur.attempts + 1 });
              onChunksChanged();
            }
          }
        }
        lastTimeRef.current = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [effFrom, effTo, currentChunkId, manifest.id, onChunksChanged]);

  function nudge(setter: (n: number) => void, cur: number, step: number, min: number, max: number, dir: 1 | -1) {
    const next = Math.max(min, Math.min(max, +(cur + step * dir).toFixed(3)));
    setter(next);
  }

  // ─── A/B drag handling ──────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ which: "A" | "B" } | null>(null);

  /** Convert pointer clientX → time (sec) inside the current window. */
  const pxToTime = useCallback(
    (clientX: number): number => {
      const el = svgRef.current;
      if (!el) return phrase.from;
      const rect = el.getBoundingClientRect();
      const xInSvg = ((clientX - rect.left) / rect.width) * VIEW_W;
      const t = winFrom + (xInSvg / VIEW_W) * winLen;
      return t;
    },
    [phrase.from, winFrom, winLen],
  );

  function onMarkerDown(which: "A" | "B", e: React.PointerEvent<SVGElement>) {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { which };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    const t = pxToTime(e.clientX);
    if (dragRef.current.which === "A") {
      // pre = phrase.from - t, clamped to [PAD_MIN, PAD_MAX] and so that A < B-0.3
      const maxPre = Math.min(PAD_MAX, phrase.from);
      const minPre = PAD_MIN;
      const lockedB = phrase.to + (draftPost ?? post);
      const minTime = Math.max(0, phrase.from - maxPre);
      const maxTime = Math.min(phrase.from, lockedB - 0.3);
      const tClamped = Math.max(minTime, Math.min(maxTime, t));
      const newPre = Math.max(minPre, Math.min(maxPre, phrase.from - tClamped));
      setDraftPre(+newPre.toFixed(3));
    } else {
      const maxPost = Math.min(PAD_MAX, trackDur - phrase.to);
      const minPost = PAD_MIN;
      const lockedA = Math.max(0, phrase.from - (draftPre ?? pre));
      const minTime = Math.max(phrase.to, lockedA + 0.3);
      const maxTime = Math.min(trackDur, phrase.to + maxPost);
      const tClamped = Math.max(minTime, Math.min(maxTime, t));
      const newPost = Math.max(minPost, Math.min(maxPost, tClamped - phrase.to));
      setDraftPost(+newPost.toFixed(3));
    }
  }

  function onSvgPointerUp() {
    if (!dragRef.current) return;
    if (dragRef.current.which === "A" && draftPre !== null) {
      setPre(draftPre);
    } else if (dragRef.current.which === "B" && draftPost !== null) {
      setPost(draftPost);
    }
    setDraftPre(null);
    setDraftPost(null);
    dragRef.current = null;
  }

  // ─── Mastered + next chunk ──────────────────────────────────────────
  function onMastered() {
    if (!currentChunkId) return;
    updateChunk(manifest.id, currentChunkId, { mastered: !mastered });
    onChunksChanged();
    if (!mastered && chunkIdx >= 0 && chunkIdx < sortedChunks.length - 1) {
      // jump to next on first marking-as-mastered
      onNavigate(sortedChunks[chunkIdx + 1]);
    }
  }

  const playheadX = ((Math.max(winFrom, Math.min(winTo, currentTime)) - winFrom) / winLen) * VIEW_W;

  const hasChunks = hydrated && sortedChunks.length > 0;
  const hasPrev = chunkIdx > 0;
  const hasNext = chunkIdx >= 0 && chunkIdx < sortedChunks.length - 1;

  return (
    <div className="bg-paper rounded-[28px] border border-[var(--color-border-soft)] overflow-hidden font-serif w-[360px]">
      {/* Header */}
      <div className="px-5 pt-3.5 pb-2 flex items-center justify-between">
        <Link href={`/play/${manifest.id}`} className="text-ink">
          <IconX size={20} />
        </Link>

        <div className="flex items-center gap-2">
          {hasChunks && chunkIdx >= 0 && (
            <button
              type="button"
              onClick={() => hasPrev && onNavigate(sortedChunks[chunkIdx - 1])}
              disabled={!hasPrev}
              className="text-ink disabled:opacity-25"
              aria-label="previous chunk"
            >
              <IconChevronLeft size={18} />
            </button>
          )}
          <div className="text-center min-w-[110px]">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-accent-plan)]">
              — drill —
            </div>
            <div className="text-[14px] font-mono text-ink leading-none mt-0.5 tabular-nums">
              {chunkIdx >= 0
                ? `chunk ${chunkIdx + 1}/${sortedChunks.length}`
                : phrase.lineIndex !== null
                ? `Line ${phrase.lineIndex + 1}/${phrase.totalLines}`
                : "Custom"}
            </div>
          </div>
          {hasChunks && chunkIdx >= 0 && (
            <button
              type="button"
              onClick={() => hasNext && onNavigate(sortedChunks[chunkIdx + 1])}
              disabled={!hasNext}
              className="text-ink disabled:opacity-25"
              aria-label="next chunk"
            >
              <IconChevronRight size={18} />
            </button>
          )}
        </div>

        {/* Spacer keeps the X mirrored. */}
        <div className="w-[20px]" />
      </div>

      {/* Zoomed waveform with draggable A/B */}
      <div className="px-4 pt-1.5">
        <div className="bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] px-2 py-2.5">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="block w-full"
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
            onPointerCancel={onSvgPointerUp}
          >
            <rect
              x={ax}
              y={0}
              width={Math.max(1, bx - ax)}
              height={VIEW_H}
              fill="#FAEEDA"
              opacity="0.45"
              rx="3"
            />
            <line x1="0" y1={CENTER_Y} x2={VIEW_W} y2={CENTER_Y} stroke="#D3D1C7" strokeWidth="0.5" />

            <g fill="var(--color-accent-vocal)">
              {Array.from({ length: BUCKETS }).map((_, i) => {
                const v = peaks ? peaks[i] : 0;
                const halfH = Math.max(1, v * (VIEW_H * 0.42));
                const x = (i + 0.5) * (VIEW_W / BUCKETS) - 1.25;
                const y = CENTER_Y - halfH;
                return <rect key={i} x={x} y={y} width="2.5" height={halfH * 2} rx="1" />;
              })}
            </g>

            <line x1={ax} y1="0" x2={ax} y2={VIEW_H} stroke="#993C1D" strokeWidth="1.5" strokeDasharray="3,2" />
            <line x1={bx} y1="0" x2={bx} y2={VIEW_H} stroke="#993C1D" strokeWidth="1.5" strokeDasharray="3,2" />

            {/* Markers — draggable. Wide invisible hit-rect for touch. */}
            <DraggableMarker cx={ax} label="A" onPointerDown={(e) => onMarkerDown("A", e)} />
            <DraggableMarker cx={bx} label="B" onPointerDown={(e) => onMarkerDown("B", e)} />

            {/* Playhead */}
            <line x1={playheadX} y1="0" x2={playheadX} y2={VIEW_H} stroke="#2C2C2A" strokeWidth="1" />
            <polygon points={`${playheadX - 4},0 ${playheadX + 4},0 ${playheadX},5`} fill="#2C2C2A" />
          </svg>
          <div className="flex justify-between font-mono text-[8.5px] text-[#993C1D] px-1 pt-1 tracking-[0.05em]">
            <span>{fmtTime(visEffFrom)}</span>
            <span className="text-[var(--color-ink-muted)]">{(visEffTo - visEffFrom).toFixed(1)}s</span>
            <span>{fmtTime(visEffTo)}</span>
          </div>
        </div>
      </div>

      {/* Pre / Post inline row */}
      <div className="px-4 pt-2">
        <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
          <InlineNudge
            label="pre"
            value={`${pre.toFixed(2)}s`}
            onMinus={() => nudge(setPre, pre, PAD_STEP, PAD_MIN, PAD_MAX, -1)}
            onPlus={() => nudge(setPre, pre, PAD_STEP, PAD_MIN, PAD_MAX, +1)}
            minusDisabled={pre <= PAD_MIN + 1e-6}
            plusDisabled={pre >= PAD_MAX - 1e-6}
          />
          <InlineNudge
            label="post"
            value={`${post.toFixed(2)}s`}
            onMinus={() => nudge(setPost, post, PAD_STEP, PAD_MIN, PAD_MAX, -1)}
            onPlus={() => nudge(setPost, post, PAD_STEP, PAD_MIN, PAD_MAX, +1)}
            minusDisabled={post <= PAD_MIN + 1e-6}
            plusDisabled={post >= PAD_MAX - 1e-6}
          />
        </div>
      </div>

      {/* Lyrics reel — 3 lines, smoothly sliding */}
      <div className="px-4 pt-2 pb-1">
        <LyricsReel aligned={aligned} currentTime={currentTime} />
      </div>

      {/* Tempo / Pitch */}
      <div className="px-4 pt-1 grid grid-cols-2 gap-2">
        <NudgeCard
          label="tempo"
          value={`×${tempo.toFixed(2)}`}
          onMinus={() => nudge(setTempo, tempo, TEMPO_STEP, TEMPO_MIN, TEMPO_MAX, -1)}
          onPlus={() => nudge(setTempo, tempo, TEMPO_STEP, TEMPO_MIN, TEMPO_MAX, +1)}
          minusDisabled={tempo <= TEMPO_MIN + 1e-6}
          plusDisabled={tempo >= TEMPO_MAX - 1e-6}
        />
        <NudgeCard
          label="key"
          value={pitch === 0 ? "0 st" : `${pitch > 0 ? "+" : ""}${pitch} st`}
          onMinus={() => nudge(setPitch, pitch, PITCH_STEP, PITCH_MIN, PITCH_MAX, -1)}
          onPlus={() => nudge(setPitch, pitch, PITCH_STEP, PITCH_MIN, PITCH_MAX, +1)}
          minusDisabled={pitch <= PITCH_MIN}
          plusDisabled={pitch >= PITCH_MAX}
        />
      </div>

      {/* 3-mode practice selector */}
      <div className="px-4 pt-2">
        <div className="bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] p-1 grid grid-cols-3 gap-1">
          {(
            [
              { key: "acappella", label: "a cappella" },
              { key: "with", label: "with vocals" },
              { key: "minus", label: "minus" },
            ] as const
          ).map((m) => {
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                className={`rounded-[var(--radius-sm)] py-1.5 text-center transition-colors text-[12px] ${
                  active ? "bg-ink text-paper" : "text-ink hover:bg-[var(--color-surface-muted)]"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom row: record / restart / repeats / play / got it
          Every slot is the same height (h-14 = 56px) so icons + labels
          line up regardless of icon size. */}
      <div className="px-4 pt-3 pb-4 flex items-end justify-center gap-3">
        <button
          type="button"
          className="h-14 w-12 flex flex-col items-center justify-center gap-1 text-ink opacity-50 cursor-not-allowed"
          title="record (coming soon)"
          disabled
        >
          <IconMicrophone size={22} />
          <span className="font-mono text-[8px] text-[var(--color-ink-muted)] leading-none">record</span>
        </button>

        <button
          type="button"
          disabled={!audioReady}
          onClick={() => engineRef.current?.seekToLoopStart()}
          className="h-14 w-12 flex flex-col items-center justify-center gap-1 text-ink disabled:opacity-30"
          title="restart loop from A"
        >
          <IconPlayerSkipBackFilled size={22} />
          <span className="font-mono text-[8px] text-[var(--color-ink-muted)] leading-none">A</span>
        </button>

        <div
          className="h-14 w-12 flex flex-col items-center justify-center gap-1"
          title="loop repeats"
          data-testid="repeats-counter"
        >
          <span className="font-mono text-[22px] text-ink tabular-nums leading-none">
            {repeats}
            <span className="text-[12px] text-[var(--color-ink-muted)]">×</span>
          </span>
          <span className="font-mono text-[8px] text-[var(--color-ink-muted)] leading-none">loops</span>
        </div>

        <button
          type="button"
          disabled={!audioReady || processing}
          onClick={() => engineRef.current?.toggle()}
          className="w-14 h-14 rounded-full bg-ink flex items-center justify-center text-paper disabled:opacity-50 shrink-0"
        >
          {processing ? (
            <span className="font-mono text-[9px] text-paper">…</span>
          ) : playing ? (
            <IconPlayerPauseFilled size={24} />
          ) : (
            <IconPlayerPlayFilled size={24} />
          )}
        </button>

        <button
          type="button"
          onClick={onMastered}
          disabled={!currentChunkId}
          className="h-14 w-12 flex flex-col items-center justify-center gap-1 disabled:opacity-30"
          title={
            !currentChunkId
              ? "save as chunk first to track mastery"
              : mastered
              ? "unmark mastered"
              : "mark mastered & next"
          }
        >
          <IconCheck
            size={22}
            className={mastered ? "text-[var(--color-accent-success)]" : "text-ink"}
          />
          <span className="font-mono text-[8px] text-[var(--color-ink-muted)] leading-none">
            {mastered ? "mastered" : "got it"}
          </span>
        </button>
      </div>
    </div>
  );
}

function NudgeCard({
  label,
  value,
  onMinus,
  onPlus,
  minusDisabled,
  plusDisabled,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  return (
    <div className="bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] px-2 py-1.5">
      <div className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-[var(--color-ink-muted)] text-center">
        {label}
      </div>
      <div className="flex items-center justify-between mt-0.5">
        <button
          type="button"
          onClick={onMinus}
          disabled={minusDisabled}
          className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] text-ink flex items-center justify-center disabled:opacity-30"
        >
          <IconMinus size={14} />
        </button>
        <div className="font-mono text-[14px] text-ink tabular-nums">{value}</div>
        <button
          type="button"
          onClick={onPlus}
          disabled={plusDisabled}
          className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] text-ink flex items-center justify-center disabled:opacity-30"
        >
          <IconPlus size={14} />
        </button>
      </div>
    </div>
  );
}

function InlineNudge({
  label,
  value,
  onMinus,
  onPlus,
  minusDisabled,
  plusDisabled,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="uppercase tracking-[0.1em] text-[var(--color-ink-muted)]">{label}</span>
      <button
        type="button"
        onClick={onMinus}
        disabled={minusDisabled}
        className="w-5 h-5 rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] text-ink flex items-center justify-center disabled:opacity-30"
      >
        <IconMinus size={12} />
      </button>
      <span className="text-ink tabular-nums min-w-[38px] text-center">{value}</span>
      <button
        type="button"
        onClick={onPlus}
        disabled={plusDisabled}
        className="w-5 h-5 rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] text-ink flex items-center justify-center disabled:opacity-30"
      >
        <IconPlus size={12} />
      </button>
    </div>
  );
}

function DraggableMarker({
  cx,
  label,
  onPointerDown,
}: {
  cx: number;
  label: string;
  onPointerDown: (e: React.PointerEvent<SVGElement>) => void;
}) {
  return (
    <g style={{ touchAction: "none", cursor: "ew-resize" }}>
      {/* Wide invisible hit area for touch */}
      <rect
        x={cx - MARKER_HIT}
        y={0}
        width={MARKER_HIT * 2}
        height={VIEW_H}
        fill="transparent"
        onPointerDown={onPointerDown}
      />
      <circle
        cx={cx}
        cy={CENTER_Y}
        r="6"
        fill="#FAF7F2"
        stroke="#993C1D"
        strokeWidth="1.5"
        onPointerDown={onPointerDown}
      />
      <text
        x={cx}
        y={CENTER_Y + 3.5}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="7"
        fill="#993C1D"
        fontWeight="bold"
        style={{ pointerEvents: "none" }}
      >
        {label}
      </text>
    </g>
  );
}
