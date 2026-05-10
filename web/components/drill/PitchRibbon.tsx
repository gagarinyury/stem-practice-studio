"use client";

/**
 * Renders the target vocal pitch curve under the waveform, plus a live
 * dot at the playhead showing the singer's mic pitch. Y-axis = semitones
 * relative to the chunk's median pitch (±12 fits an octave each way).
 *
 * Pure SVG: no animation libs needed since the data updates on every
 * RAF tick from DrillView.
 */
import { useMemo } from "react";
import { centsDelta, hzToMidi, type PitchCurve } from "@/lib/pitch";

interface Props {
  curve: PitchCurve | null;
  /** Loop bounds in seconds — controls X mapping. */
  fromSec: number;
  toSec: number;
  /** Current playhead in seconds (track time). */
  currentTime: number;
  /** Live mic Hz (NaN if silent / undetected). */
  micHz: number;
  /** Last loop's "% in tune" — shown under the ribbon. */
  lastScore: number | null;
  /** History of last 5 loop scores (newest last) — bar chart. */
  scoreHistory: number[];
  /** Whether mic capture is active — colors playhead dot. */
  micActive: boolean;
}

const W = 320;
const H = 70;
const SEMITONE_RANGE = 12; // ± semitones from median

export function PitchRibbon({
  curve,
  fromSec,
  toSec,
  currentTime,
  micHz,
  lastScore,
  scoreHistory,
  micActive,
}: Props) {
  const midMidi = useMemo(() => {
    if (!curve || curve.hz.length === 0) return 60; // C4 fallback
    const valid: number[] = [];
    for (let i = 0; i < curve.hz.length; i++) {
      if (Number.isFinite(curve.hz[i])) valid.push(hzToMidi(curve.hz[i]));
    }
    if (valid.length === 0) return 60;
    valid.sort((a, b) => a - b);
    return valid[Math.floor(valid.length / 2)];
  }, [curve]);

  const targetPath = useMemo(() => {
    if (!curve || curve.times.length === 0) return "";
    const len = Math.max(0.001, toSec - fromSec);
    const segments: string[] = [];
    let pen = false;
    for (let i = 0; i < curve.times.length; i++) {
      const hz = curve.hz[i];
      const t = curve.times[i];
      if (t < fromSec || t > toSec || !Number.isFinite(hz)) {
        pen = false;
        continue;
      }
      const x = ((t - fromSec) / len) * W;
      const dSemi = hzToMidi(hz) - midMidi;
      const y = H / 2 - (dSemi / SEMITONE_RANGE) * (H / 2 - 6);
      segments.push(`${pen ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`);
      pen = true;
    }
    return segments.join(" ");
  }, [curve, midMidi, fromSec, toSec]);

  const len = Math.max(0.001, toSec - fromSec);
  const playheadX = ((Math.max(fromSec, Math.min(toSec, currentTime)) - fromSec) / len) * W;

  // Mic dot Y + color
  let dotY: number | null = null;
  let dotColor = "var(--color-accent-vocal)";
  if (Number.isFinite(micHz) && curve && curve.times.length > 0) {
    // Find target pitch at current playhead time (linear interp)
    const lo = Math.floor((currentTime - curve.fromSec) / curve.hopSec);
    const hi = lo + 1;
    let targetHz = NaN;
    if (lo >= 0 && hi < curve.times.length) {
      const a = curve.hz[lo];
      const b = curve.hz[hi];
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const frac = (currentTime - curve.times[lo]) / (curve.times[hi] - curve.times[lo]);
        targetHz = a + (b - a) * frac;
      }
    }
    const dSemi = hzToMidi(micHz) - midMidi;
    dotY = H / 2 - (dSemi / SEMITONE_RANGE) * (H / 2 - 6);
    dotY = Math.max(4, Math.min(H - 4, dotY));
    if (Number.isFinite(targetHz)) {
      const cents = Math.abs(centsDelta(micHz, targetHz, true));
      if (cents < 25) dotColor = "var(--color-accent-success)";
      else if (cents < 50) dotColor = "#D9A53B";
      else dotColor = "var(--color-accent-warn)";
    }
  }

  return (
    <div className="bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] px-2 py-2 mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full">
        {/* Center reference line (median pitch) */}
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#E5E1D5" strokeWidth="0.5" strokeDasharray="2,3" />
        {/* ±5 semitones grid */}
        <line x1="0" y1={H / 2 - (5 / SEMITONE_RANGE) * (H / 2 - 6)} x2={W} y2={H / 2 - (5 / SEMITONE_RANGE) * (H / 2 - 6)} stroke="#F0EDE3" strokeWidth="0.5" />
        <line x1="0" y1={H / 2 + (5 / SEMITONE_RANGE) * (H / 2 - 6)} x2={W} y2={H / 2 + (5 / SEMITONE_RANGE) * (H / 2 - 6)} stroke="#F0EDE3" strokeWidth="0.5" />

        {/* Target curve */}
        {targetPath && (
          <path d={targetPath} fill="none" stroke="#9C9890" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Playhead vertical line */}
        <line x1={playheadX} y1="0" x2={playheadX} y2={H} stroke="#2C2C2A" strokeWidth="0.5" opacity="0.4" />

        {/* Live mic dot */}
        {micActive && dotY !== null && (
          <circle cx={playheadX} cy={dotY} r="5" fill={dotColor} stroke="white" strokeWidth="1.5" />
        )}
      </svg>

      {/* Score line under ribbon */}
      <div className="flex items-center justify-between font-mono text-[10px] text-[var(--color-ink-muted)] px-1 pt-1.5 tracking-[0.05em]">
        <span>
          {lastScore !== null ? (
            <>
              <span className="text-[14px] tabular-nums text-ink">{Math.round(lastScore)}%</span>
              <span> in tune</span>
            </>
          ) : micActive ? (
            <span className="text-[var(--color-accent-vocal)]">listening…</span>
          ) : curve === null ? (
            <span>analyzing vocal…</span>
          ) : (
            <span>tap record to start</span>
          )}
        </span>
        <span className="flex items-end gap-[2px] h-[14px]">
          {scoreHistory.map((s, i) => (
            <span
              key={i}
              className="w-[6px] bg-[var(--color-accent-vocal)] rounded-sm opacity-80"
              style={{ height: `${Math.max(2, (s / 100) * 14)}px` }}
              title={`${Math.round(s)}%`}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
