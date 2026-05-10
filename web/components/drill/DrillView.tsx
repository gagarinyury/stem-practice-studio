"use client";

import {
  IconBookmark,
  IconCheck,
  IconMicrophone,
  IconMinus,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AlignedLyrics, Manifest } from "@/lib/manifest";
import { pickPhrase, fmtTime, type Phrase } from "@/lib/drill";
import { stemUrl } from "@/lib/manifest";
import { StemEngine } from "@/lib/audio-engine";
import { LyricsReel } from "./LyricsReel";

interface Props {
  manifest: Manifest;
  aligned: AlignedLyrics;
  initialLineIndex?: number;
  initialFromSec?: number;
  initialToSec?: number;
  initialPre?: number;
  initialPost?: number;
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

export function DrillView({
  manifest,
  aligned,
  initialLineIndex,
  initialFromSec,
  initialToSec,
  initialPre = 0,
  initialPost = 0,
}: Props) {
  const phrase = useMemo<Phrase | null>(
    () =>
      pickPhrase(aligned, {
        fromSec: initialFromSec,
        toSec: initialToSec,
        lineIndex: initialLineIndex,
      }),
    [aligned, initialLineIndex, initialFromSec, initialToSec],
  );

  if (!phrase) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-muted font-mono text-[12px]">
        no phrase to drill — track has no aligned lyrics
      </div>
    );
  }

  return <DrillInner manifest={manifest} aligned={aligned} phrase={phrase} initialPre={initialPre} initialPost={initialPost} />;
}

function DrillInner({
  manifest,
  aligned,
  phrase,
  initialPre,
  initialPost,
}: {
  manifest: Manifest;
  aligned: AlignedLyrics;
  phrase: Phrase;
  initialPre: number;
  initialPost: number;
}) {
  // Controls.
  const [tempo, setTempo] = useState(1.0);
  const [pitch, setPitch] = useState(0);
  const [mode, setMode] = useState<"acappella" | "with" | "minus">("with");
  const [pre, setPre] = useState(initialPre);
  const [post, setPost] = useState(initialPost);
  const [repeats, setRepeats] = useState(0);

  // Effective loop = phrase ± padding, clamped to track duration.
  const trackDur = manifest.duration ?? phrase.to + 5;
  const effFrom = Math.max(0, phrase.from - pre);
  const effTo = Math.min(trackDur, phrase.to + post);

  // Zoom window: a touch wider than the loop so A/B markers aren't on the edge.
  const winFrom = Math.max(0, effFrom - 0.3);
  const winTo = Math.min(trackDur, effTo + 0.3);
  const winLen = Math.max(0.001, winTo - winFrom);

  const ax = ((effFrom - winFrom) / winLen) * VIEW_W;
  const bx = ((effTo - winFrom) / winLen) * VIEW_W;

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

  // Recompute zoom-slice peaks whenever the visible window changes.
  useEffect(() => {
    if (!audioReady || !engineRef.current) return;
    const range = engineRef.current.getPeaksRange(BUCKETS, winFrom, winTo);
    const merged = new Float32Array(BUCKETS);
    for (let i = 0; i < BUCKETS; i++) merged[i] = (range.left[i] + range.right[i]) * 0.5;
    setPeaks(merged);
  }, [winFrom, winTo, audioReady]);

  // Apply tempo / pitch / loop range via rubberband. Debounced so the user
  // can click ± several times before triggering a regen.
  const [processing, setProcessing] = useState(false);
  useEffect(() => {
    if (!audioReady) return;
    const handle = setTimeout(async () => {
      const e = engineRef.current;
      if (!e) return;
      const timeRatio = 1 / tempo; // tempo<1 → output longer (timeRatio>1)
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

  // RAF: update playhead + count loop wraps.
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
        }
        lastTimeRef.current = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [effFrom, effTo]);

  function nudge(setter: (n: number) => void, cur: number, step: number, min: number, max: number, dir: 1 | -1) {
    const next = Math.max(min, Math.min(max, +(cur + step * dir).toFixed(3)));
    setter(next);
  }

  const playheadX = ((Math.max(winFrom, Math.min(winTo, currentTime)) - winFrom) / winLen) * VIEW_W;

  return (
    <div className="bg-paper rounded-[28px] border border-[var(--color-border-soft)] overflow-hidden font-serif w-[360px]">
      {/* Header */}
      <div className="px-5 pt-3.5 pb-2 flex items-center justify-between">
        <Link href={`/play/${manifest.id}`} className="text-ink">
          <IconX size={20} />
        </Link>
        <div className="text-center">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-accent-plan)]">
            — drill —
          </div>
          <div className="text-[14px] font-mono text-ink leading-none mt-0.5">
            {phrase.lineIndex !== null
              ? `Line ${phrase.lineIndex + 1}/${phrase.totalLines}`
              : "Custom"}
          </div>
        </div>
        <button type="button" className="text-ink">
          <IconBookmark size={20} />
        </button>
      </div>

      {/* Zoomed waveform */}
      <div className="px-4 pt-1.5">
        <div className="bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] px-2 py-2.5">
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block w-full">
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

            {/* Marker labels */}
            <Marker cx={ax} label="A" />
            <Marker cx={bx} label="B" />

            {/* Playhead */}
            <line x1={playheadX} y1="0" x2={playheadX} y2={VIEW_H} stroke="#2C2C2A" strokeWidth="1" />
            <polygon points={`${playheadX - 4},0 ${playheadX + 4},0 ${playheadX},5`} fill="#2C2C2A" />
          </svg>
          <div className="flex justify-between font-mono text-[8.5px] text-[#993C1D] px-1 pt-1 tracking-[0.05em]">
            <span>{fmtTime(effFrom)}</span>
            <span className="text-[var(--color-ink-muted)]">{(effTo - effFrom).toFixed(1)}s · {repeats}×</span>
            <span>{fmtTime(effTo)}</span>
          </div>
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

      {/* Pre / Post padding */}
      <div className="px-4 pt-2 grid grid-cols-2 gap-2">
        <NudgeCard
          label="pre"
          value={`+${pre.toFixed(2)}s`}
          onMinus={() => nudge(setPre, pre, PAD_STEP, PAD_MIN, PAD_MAX, -1)}
          onPlus={() => nudge(setPre, pre, PAD_STEP, PAD_MIN, PAD_MAX, +1)}
          minusDisabled={pre <= PAD_MIN + 1e-6}
          plusDisabled={pre >= PAD_MAX - 1e-6}
        />
        <NudgeCard
          label="post"
          value={`+${post.toFixed(2)}s`}
          onMinus={() => nudge(setPost, post, PAD_STEP, PAD_MIN, PAD_MAX, -1)}
          onPlus={() => nudge(setPost, post, PAD_STEP, PAD_MIN, PAD_MAX, +1)}
          minusDisabled={post <= PAD_MIN + 1e-6}
          plusDisabled={post >= PAD_MAX - 1e-6}
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

      {/* Bottom row: record / restart / play / got it */}
      <div className="px-4 pt-3 pb-4 flex items-center justify-center gap-5">
        <button type="button" className="flex flex-col items-center gap-0.5 text-ink">
          <IconMicrophone size={22} />
          <span className="font-mono text-[8px] text-[var(--color-ink-muted)]">record</span>
        </button>

        <button
          type="button"
          disabled={!audioReady}
          onClick={() => engineRef.current?.seekToLoopStart()}
          className="flex flex-col items-center gap-0.5 text-ink disabled:opacity-30"
          title="restart loop from A"
        >
          <IconPlayerSkipBackFilled size={20} />
          <span className="font-mono text-[8px] text-[var(--color-ink-muted)]">A</span>
        </button>

        <button
          type="button"
          disabled={!audioReady || processing}
          onClick={() => engineRef.current?.toggle()}
          className="w-14 h-14 rounded-full bg-ink flex items-center justify-center text-paper disabled:opacity-50"
        >
          {processing ? (
            <span className="font-mono text-[9px] text-paper">…</span>
          ) : playing ? (
            <IconPlayerPauseFilled size={24} />
          ) : (
            <IconPlayerPlayFilled size={24} />
          )}
        </button>

        <button type="button" className="flex flex-col items-center gap-0.5">
          <IconCheck size={22} className="text-[var(--color-accent-success)]" />
          <span className="font-mono text-[8px] text-[var(--color-ink-muted)]">got it</span>
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

function Marker({ cx, label }: { cx: number; label: string }) {
  return (
    <g>
      <circle cx={cx} cy={CENTER_Y} r="5" fill="#FAF7F2" stroke="#993C1D" strokeWidth="1.5" />
      <text
        x={cx}
        y={CENTER_Y + 3.5}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="7"
        fill="#993C1D"
        fontWeight="bold"
      >
        {label}
      </text>
    </g>
  );
}
