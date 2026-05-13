"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { LoopRange } from "./TrackView";

interface Props {
  duration: number;
  currentTime: number;
  loop: LoopRange | null;
  onSeek: (t: number) => void;
  onLoopChange?: (r: LoopRange) => void;
}

type DragMode = "seek" | "shift" | "edge-a" | "edge-b" | null;

export function Timeline({ duration, currentTime, loop, onSeek, onLoopChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startLoop: LoopRange | null;
  }>({ mode: null, startX: 0, startLoop: null });
  const [hovering, setHovering] = useState(false);

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const loopFromPct = loop && duration > 0 ? (loop.from / duration) * 100 : 0;
  const loopToPct = loop && duration > 0 ? (loop.to / duration) * 100 : 0;

  const timeFromX = useCallback(
    (clientX: number): number => {
      const el = ref.current;
      if (!el || duration <= 0) return 0;
      const r = el.getBoundingClientRect();
      return ((clientX - r.left) / r.width) * duration;
    },
    [duration],
  );

  const waveformBars = useMemo(() => {
    if (duration <= 0) return [];
    const numBars = 150;
    const bars = [];
    for (let i = 0; i < numBars; i++) {
      const h1 = Math.sin(i * 0.1) * 0.5 + 0.5;
      const h2 = Math.cos(i * 0.33) * 0.5 + 0.5;
      const h3 = Math.sin(i * 0.77) * 0.5 + 0.5;
      const h4 = Math.cos(i * 2.1) * 0.5 + 0.5;
      // combine for an organic look
      const height = 15 + (h1 * 0.3 + h2 * 0.4 + h3 * 0.2 + h4 * 0.1) * 85;
      bars.push(height);
    }
    return bars;
  }, [duration]);

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const target = (e.target as HTMLElement).dataset.handle as DragMode | undefined;
    if (target === "shift" || target === "edge-a" || target === "edge-b") {
      dragRef.current = { mode: target, startX: e.clientX, startLoop: loop };
    } else {
      dragRef.current = { mode: "seek", startX: e.clientX, startLoop: loop };
      onSeek(Math.max(0, Math.min(duration, timeFromX(e.clientX))));
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag.mode) return;
    if (drag.mode === "seek") {
      onSeek(Math.max(0, Math.min(duration, timeFromX(e.clientX))));
      return;
    }
    if (!drag.startLoop || !onLoopChange) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dxSec = ((e.clientX - drag.startX) / r.width) * duration;
    const startLoop = drag.startLoop;
    if (drag.mode === "shift") {
      let from = startLoop.from + dxSec;
      let to = startLoop.to + dxSec;
      if (from < 0) {
        to -= from;
        from = 0;
      }
      if (to > duration) {
        from -= to - duration;
        to = duration;
      }
      onLoopChange({ ...startLoop, from, to });
    } else if (drag.mode === "edge-a") {
      const from = Math.max(0, Math.min(startLoop.to - 0.2, startLoop.from + dxSec));
      onLoopChange({ ...startLoop, from });
    } else if (drag.mode === "edge-b") {
      const to = Math.max(startLoop.from + 0.2, Math.min(duration, startLoop.to + dxSec));
      onLoopChange({ ...startLoop, to });
    }
  }

  function onPointerUp() {
    dragRef.current = { mode: null, startX: 0, startLoop: null };
  }

  return (
    <div
      ref={ref}
      className="relative h-12 select-none touch-none"
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* waveform background */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[40px] flex items-center justify-between pointer-events-none opacity-30">
        {waveformBars.map((h, i) => (
          <div
            key={i}
            className="w-[2px] bg-[var(--color-ink-faint)] rounded-full"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>

      {/* active waveform overlay */}
      <div
        className="absolute inset-y-0 left-0 top-1/2 -translate-y-1/2 h-[40px] flex items-center justify-between pointer-events-none overflow-hidden"
        style={{ width: `${pct}%` }}
      >
        <div className="flex items-center justify-between w-full" style={{ width: ref.current?.getBoundingClientRect().width || "100vw" }}>
          {waveformBars.map((h, i) => (
            <div
              key={i}
              className="w-[2px] bg-[var(--color-ink)] rounded-full"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>

      {/* loop band */}
      {loop && (
        <>
          <div
            data-handle="shift"
            className="absolute top-1/2 -translate-y-1/2 h-[48px] rounded-md bg-[var(--color-accent-vocal-100)]/20 border border-[var(--color-accent-vocal)]/40 cursor-grab active:cursor-grabbing transition-shadow hover:bg-[var(--color-accent-vocal-100)]/30"
            style={{
              left: `${loopFromPct}%`,
              width: `${Math.max(0.4, loopToPct - loopFromPct)}%`,
            }}
          >
            {/* progress inside loop band */}
            {currentTime >= loop.from && currentTime <= loop.to && (
              <div
                className="absolute inset-y-0 left-0 bg-[var(--color-accent-vocal)]/40 pointer-events-none"
                style={{
                  width: `${((currentTime - loop.from) / Math.max(0.01, loop.to - loop.from)) * 100}%`,
                }}
              />
            )}
          </div>
          {/* A handle */}
          <div
            data-handle="edge-a"
            className="absolute top-1/2 -translate-y-1/2 w-[12px] h-[54px] -ml-[6px] rounded-full bg-[var(--color-accent-vocal)] cursor-ew-resize hover:scale-y-105 transition-transform shadow-md border-2 border-[var(--color-surface)] z-10 flex items-center justify-center"
            style={{ left: `${loopFromPct}%` }}
            title="A"
          >
            <div className="w-[2px] h-[12px] bg-white/50 rounded-full" />
          </div>
          {/* B handle */}
          <div
            data-handle="edge-b"
            className="absolute top-1/2 -translate-y-1/2 w-[12px] h-[54px] -ml-[6px] rounded-full bg-[var(--color-accent-vocal)] cursor-ew-resize hover:scale-y-105 transition-transform shadow-md border-2 border-[var(--color-surface)] z-10 flex items-center justify-center"
            style={{ left: `${loopToPct}%` }}
            title="B"
          >
            <div className="w-[2px] h-[12px] bg-white/50 rounded-full" />
          </div>
        </>
      )}

      {/* playhead line */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-[2px] h-[56px] -ml-[1px] bg-[var(--color-accent-warn)] pointer-events-none z-20 shadow-[0_0_8px_rgba(248,81,73,0.6)]"
        style={{ left: `${pct}%` }}
      />
      {/* playhead handle */}
      <div
        className={`absolute top-0 w-[14px] h-[14px] -ml-[7px] -mt-[6px] rounded-full bg-[var(--color-accent-warn)] border-2 border-[var(--color-surface)] pointer-events-none transition-shadow z-20 ${
          hovering ? "shadow-[0_0_0_4px_rgba(248,81,73,0.3)]" : ""
        }`}
        style={{ left: `${pct}%` }}
      />
      {/* time labels at edges */}
      <div className="absolute left-0 bottom-0 font-mono text-[9px] text-[var(--color-ink-faint)]">
        0:00
      </div>
      <div className="absolute right-0 bottom-0 font-mono text-[9px] text-[var(--color-ink-faint)]">
        {fmt(duration)}
      </div>
    </div>
  );
}

function fmt(s: number): string {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}
