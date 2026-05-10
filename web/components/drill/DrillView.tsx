"use client";

import {
  IconBookmark,
  IconCheck,
  IconMicrophone,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconX,
} from "@tabler/icons-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AlignedLyrics, Manifest } from "@/lib/manifest";
import { pickPhrase, fmtTime, type Phrase } from "@/lib/drill";
import { stemUrl } from "@/lib/manifest";
import { StemEngine } from "@/lib/audio-engine";

interface Props {
  manifest: Manifest;
  aligned: AlignedLyrics;
  initialLineIndex?: number;
  initialFromSec?: number;
  initialToSec?: number;
}

const ZOOM_PAD = 0.7; // sec of context on each side of the loop
const BUCKETS = 53; // matches mockup bar count
const VIEW_W = 320;
const VIEW_H = 80;
const CENTER_Y = 40;

export function DrillView({
  manifest,
  aligned,
  initialLineIndex,
  initialFromSec,
  initialToSec,
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

  return <DrillInner manifest={manifest} phrase={phrase} />;
}

function DrillInner({ manifest, phrase }: { manifest: Manifest; phrase: Phrase }) {
  // Zoom window: phrase ± ZOOM_PAD sec.
  const winFrom = Math.max(0, phrase.from - ZOOM_PAD);
  const winTo = Math.min(manifest.duration ?? phrase.to + ZOOM_PAD, phrase.to + ZOOM_PAD);
  const winLen = Math.max(0.001, winTo - winFrom);

  // Loop A/B mapped to SVG x-coordinates.
  const ax = ((phrase.from - winFrom) / winLen) * VIEW_W;
  const bx = ((phrase.to - winFrom) / winLen) * VIEW_W;

  // Controls.
  const [tempo, setTempo] = useState(1.0);
  const [keyShift, setKeyShift] = useState(0);
  const [mode, setMode] = useState<"acappella" | "with" | "minus">("with");
  const [repeats, setRepeats] = useState(0);

  // Engine + peaks for the zoom slice.
  const engineRef = useRef<StemEngine | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(phrase.from);

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
        const range = engine.getPeaksRange(BUCKETS, winFrom, winTo);
        const merged = new Float32Array(BUCKETS);
        for (let i = 0; i < BUCKETS; i++) merged[i] = (range.left[i] + range.right[i]) * 0.5;
        setPeaks(merged);
        engine.setLoop({ from: phrase.from, to: phrase.to });
        engine.seek(phrase.from);
        setAudioReady(true);
      })
      .catch(() => {
        /* loading failed — bars stay flat */
      });
    return () => {
      cancelled = true;
      engine.dispose();
    };
  }, [manifest.id, manifest.stems, winFrom, winTo, phrase.from, phrase.to]);

  // RAF: update playhead + count loop wraps.
  const lastTimeRef = useRef(phrase.from);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const e = engineRef.current;
      if (e) {
        const t = e.currentTime;
        setCurrentTime(t);
        // Detect a loop wrap: time jumped backwards by ~ loopLen.
        const len = phrase.to - phrase.from;
        if (len > 0.1 && lastTimeRef.current > t + len * 0.5) {
          setRepeats((r) => r + 1);
        }
        lastTimeRef.current = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phrase.from, phrase.to]);

  // Apply tempo to engine.
  useEffect(() => {
    engineRef.current?.setPlaybackRate(tempo);
  }, [tempo]);

  // Apply practice mode to engine.
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

  return (
    <div className="bg-paper rounded-[28px] border border-[var(--color-border-soft)] overflow-hidden font-serif w-[360px]">
      {/* Status bar */}
      <div className="px-5 pt-3.5 flex justify-between font-mono text-[11px] text-ink">
        <span>9:41</span>
        <span>·</span>
      </div>

      {/* Header */}
      <div className="px-5 pt-4 flex items-center justify-between">
        <Link href={`/play/${manifest.id}`} className="text-ink">
          <IconX size={22} />
        </Link>
        <div className="text-center">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-accent-plan)]">
            — drill mode —
          </div>
          <div className="text-[19px] text-ink leading-none mt-1">
            {phrase.lineIndex !== null
              ? `Line ${phrase.lineIndex + 1} of ${phrase.totalLines}`
              : "Custom range"}
          </div>
        </div>
        <button type="button" className="text-ink">
          <IconBookmark size={22} />
        </button>
      </div>

      {/* Zoomed waveform */}
      <div className="px-5 pt-[22px]">
        <div className="bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] px-2 py-3.5">
          <div className="flex justify-between font-mono text-[9px] text-[var(--color-ink-muted)] px-1.5 pb-2">
            <span>{fmtTime(winFrom)}</span>
            <span>{fmtTime((winFrom + winTo) / 2)}</span>
            <span>{fmtTime(winTo)}</span>
          </div>

          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block w-full">
            {/* Loop range tint */}
            <rect x={ax} y={0} width={Math.max(1, bx - ax)} height={VIEW_H} fill="#FAEEDA" opacity="0.45" rx="4" />
            <line x1="0" y1={CENTER_Y} x2={VIEW_W} y2={CENTER_Y} stroke="#D3D1C7" strokeWidth="0.5" />

            {/* Waveform bars (real peaks for the zoom slice) */}
            <g fill="var(--color-accent-vocal)">
              {Array.from({ length: BUCKETS }).map((_, i) => {
                const v = peaks ? peaks[i] : 0;
                const halfH = Math.max(1, v * (VIEW_H * 0.45));
                const x = (i + 0.5) * (VIEW_W / BUCKETS) - 1.5;
                const y = CENTER_Y - halfH;
                return <rect key={i} x={x} y={y} width="3" height={halfH * 2} rx="1" />;
              })}
            </g>

            {/* A / B markers */}
            <line x1={ax} y1="0" x2={ax} y2={VIEW_H} stroke="#993C1D" strokeWidth="1.5" strokeDasharray="3,2" />
            <line x1={bx} y1="0" x2={bx} y2={VIEW_H} stroke="#993C1D" strokeWidth="1.5" strokeDasharray="3,2" />
            <rect x={ax} y={0} width={Math.max(1, bx - ax)} height={VIEW_H} fill="#D85A30" opacity="0.06" />
            <Marker cx={ax} label="A" />
            <Marker cx={bx} label="B" />

            {/* Playhead — follows engine.currentTime */}
            {(() => {
              const t = playing ? currentTime : phrase.from;
              const px = ((t - winFrom) / winLen) * VIEW_W;
              return (
                <>
                  <line x1={px} y1="0" x2={px} y2={VIEW_H} stroke="#2C2C2A" strokeWidth="1" />
                  <polygon points={`${px - 4},0 ${px + 4},0 ${px},6`} fill="#2C2C2A" />
                </>
              );
            })()}
          </svg>

          <div className="flex justify-between font-mono text-[9px] text-[#993C1D] px-1.5 pt-2 tracking-[0.05em]">
            <span>A — {fmtTime(phrase.from)}</span>
            <span className="text-[var(--color-ink-muted)]">{(phrase.to - phrase.from).toFixed(1)} sec loop</span>
            <span>B — {fmtTime(phrase.to)}</span>
          </div>
        </div>
      </div>

      {/* Lyric focus */}
      <div className="px-6 pt-[22px] text-center">
        <div className="text-[26px] leading-[1.35] text-ink italic">
          {renderLyric(phrase.text)}
        </div>
        <div className="font-mono text-[10px] text-[var(--color-ink-muted)] mt-2 tracking-[0.05em]">
          {phrase.words.length} words · {(phrase.to - phrase.from).toFixed(1)}s
        </div>
      </div>

      {/* Controls */}
      <div className="px-5 pt-[22px] space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <ControlCard label="tempo">
            <div className="text-[22px] text-ink mt-0.5">×{tempo.toFixed(2)}</div>
            <input
              type="range"
              min={50}
              max={120}
              value={Math.round(tempo * 100)}
              onChange={(e) => setTempo(Number(e.target.value) / 100)}
              className="w-full mt-1.5"
            />
          </ControlCard>

          <ControlCard label="key">
            <div className="text-[22px] text-ink mt-0.5">
              {keyShift >= 0 ? "+" : ""}{keyShift}
              <span className="text-[13px] text-[var(--color-ink-muted)] font-mono ml-1">st</span>
            </div>
            <input
              type="range"
              min={-12}
              max={12}
              value={keyShift}
              onChange={(e) => setKeyShift(Number(e.target.value))}
              className="w-full mt-1.5"
            />
          </ControlCard>
        </div>

        {/* 3-mode practice selector */}
        <div className="bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] p-1 grid grid-cols-3 gap-1">
          {(
            [
              { key: "acappella", label: "a cappella", hint: "vocal only" },
              { key: "with", label: "with vocals", hint: "full mix" },
              { key: "minus", label: "minus", hint: "no vocals" },
            ] as const
          ).map((m) => {
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                className={`rounded-[var(--radius-sm)] py-1.5 px-2 text-center transition-colors ${
                  active
                    ? "bg-ink text-paper"
                    : "text-ink hover:bg-[var(--color-surface-muted)]"
                }`}
              >
                <div className="text-[12px] leading-tight">{m.label}</div>
                <div
                  className={`font-mono text-[8px] tracking-[0.05em] uppercase mt-0.5 ${
                    active ? "text-paper/70" : "text-[var(--color-ink-muted)]"
                  }`}
                >
                  {m.hint}
                </div>
              </button>
            );
          })}
        </div>

        <ControlCard label="repeats">
          <div className="flex justify-between items-center mt-1">
            <span className="text-[18px] text-ink">∞</span>
            <span className="font-mono text-[11px] text-[var(--color-ink-muted)]">{repeats} done</span>
          </div>
        </ControlCard>
      </div>

      {/* Bottom row: record / play / got it */}
      <div className="px-6 pt-[22px] pb-7 flex items-center justify-center gap-7">
        <button type="button" className="flex flex-col items-center gap-1 text-ink">
          <IconMicrophone size={26} />
          <span className="font-mono text-[9px] text-[var(--color-ink-muted)]">record</span>
        </button>

        <button
          type="button"
          disabled={!audioReady}
          onClick={() => engineRef.current?.toggle()}
          className="w-16 h-16 rounded-full bg-ink flex items-center justify-center text-paper disabled:opacity-50"
        >
          {playing ? <IconPlayerPauseFilled size={28} /> : <IconPlayerPlayFilled size={28} />}
        </button>

        <button type="button" className="flex flex-col items-center gap-1">
          <IconCheck size={26} className="text-[var(--color-accent-success)]" />
          <span className="font-mono text-[9px] text-[var(--color-ink-muted)]">got it</span>
        </button>
      </div>
    </div>
  );
}

function ControlCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] px-3.5 py-2.5">
      <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-muted)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function Marker({ cx, label }: { cx: number; label: string }) {
  return (
    <g>
      <circle cx={cx} cy={CENTER_Y} r="6" fill="#FAF7F2" stroke="#993C1D" strokeWidth="1.5" />
      <text
        x={cx}
        y={CENTER_Y + 4}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="8"
        fill="#993C1D"
        fontWeight="bold"
      >
        {label}
      </text>
    </g>
  );
}

/** Highlight the centred word of a line (mockup-style accent). */
function renderLyric(text: string): React.ReactNode {
  const tokens = text.split(/(\s+)/);
  const wordIdx: number[] = [];
  tokens.forEach((t, i) => {
    if (/\S/.test(t)) wordIdx.push(i);
  });
  if (wordIdx.length === 0) return text;
  const focus = wordIdx[Math.floor(wordIdx.length / 2)];
  return tokens.map((t, i) =>
    i === focus ? (
      <span
        key={i}
        className="bg-[var(--color-accent-vocal)] text-paper rounded-[3px]"
        style={{ padding: "0 5px" }}
      >
        {t}
      </span>
    ) : (
      <span key={i}>{t}</span>
    ),
  );
}
