"use client";

/**
 * Aesthetic vocal envelope under the waveform. Not aiming for note-level
 * accuracy — just a smooth flowing line that traces the singer's pitch
 * with a soft fill underneath, plus a live mic dot.
 *
 * Y = semitones around the chunk's median. Smoothed pitch is rendered as
 * a fat colored stroke with a translucent fill below, like a riverline.
 */
import { useMemo } from "react";
import {
  centsDelta,
  hzToMidi,
  type PitchCurve,
} from "@/lib/pitch";

interface Props {
  curve: PitchCurve | null;
  fromSec: number;
  toSec: number;
  currentTime: number;
  micHz: number;
  lastScore: number | null;
  scoreHistory: number[];
  micActive: boolean;
}

const W = 320;
const H = 88;
const RANGE_SEMI = 8;
const PAD_Y = 8; // top/bottom padding inside ribbon

/** Heavy median + 3-tap moving average → looks like a smooth river. */
function smoothCurve(hz: Float32Array): Float32Array {
  if (hz.length === 0) return hz;
  // First pass: median window 9 over finite values
  const med = new Float32Array(hz.length);
  const half = 4;
  const tmp: number[] = [];
  for (let i = 0; i < hz.length; i++) {
    tmp.length = 0;
    for (let j = -half; j <= half; j++) {
      const k = i + j;
      if (k >= 0 && k < hz.length && Number.isFinite(hz[k])) tmp.push(hz[k]);
    }
    if (tmp.length < 5) {
      med[i] = NaN;
    } else {
      tmp.sort((a, b) => a - b);
      med[i] = tmp[Math.floor(tmp.length / 2)];
    }
  }
  // Second pass: 3-tap mean over still-finite values
  const out = new Float32Array(hz.length);
  for (let i = 0; i < hz.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = -1; j <= 1; j++) {
      const k = i + j;
      if (k >= 0 && k < hz.length && Number.isFinite(med[k])) {
        s += med[k];
        n++;
      }
    }
    out[i] = n >= 2 ? s / n : NaN;
  }
  return out;
}

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
  const smoothed = useMemo(() => (curve ? smoothCurve(curve.hz) : null), [curve]);

  const midMidi = useMemo(() => {
    if (!smoothed) return 60;
    const valid: number[] = [];
    for (let i = 0; i < smoothed.length; i++) {
      if (Number.isFinite(smoothed[i])) valid.push(hzToMidi(smoothed[i]));
    }
    if (valid.length === 0) return 60;
    valid.sort((a, b) => a - b);
    return valid[Math.floor(valid.length / 2)];
  }, [smoothed]);

  const len = Math.max(0.001, toSec - fromSec);

  function midiToY(midi: number): number {
    const dSemi = midi - midMidi;
    const usable = H - PAD_Y * 2;
    return H / 2 - (dSemi / RANGE_SEMI) * (usable / 2);
  }
  function timeToX(t: number): number {
    return ((t - fromSec) / len) * W;
  }

  /** Build an SVG path "M …L …" plus an "area" path for the fill. */
  const { stroke, area } = useMemo(() => {
    if (!curve || !smoothed) return { stroke: "", area: "" };
    const segs: string[] = [];
    const areaSegs: string[] = [];
    let pen = false;
    let firstX = 0;
    let lastX = 0;
    for (let i = 0; i < smoothed.length; i++) {
      const hz = smoothed[i];
      const t = curve.times[i];
      if (t < fromSec || t > toSec || !Number.isFinite(hz)) {
        // Close current area segment if pen was down
        if (pen) {
          areaSegs.push(`L${lastX.toFixed(2)},${(H - PAD_Y).toFixed(2)} L${firstX.toFixed(2)},${(H - PAD_Y).toFixed(2)} Z`);
        }
        pen = false;
        continue;
      }
      const x = timeToX(t);
      const dSemi = hzToMidi(hz) - midMidi;
      const usable = H - PAD_Y * 2;
      const y = H / 2 - (dSemi / RANGE_SEMI) * (usable / 2);
      const yClamped = Math.max(PAD_Y, Math.min(H - PAD_Y, y));
      segs.push(`${pen ? "L" : "M"}${x.toFixed(2)},${yClamped.toFixed(2)}`);
      if (!pen) {
        areaSegs.push(`M${x.toFixed(2)},${(H - PAD_Y).toFixed(2)} L${x.toFixed(2)},${yClamped.toFixed(2)}`);
        firstX = x;
      } else {
        areaSegs.push(`L${x.toFixed(2)},${yClamped.toFixed(2)}`);
      }
      lastX = x;
      pen = true;
    }
    if (pen) {
      areaSegs.push(`L${lastX.toFixed(2)},${(H - PAD_Y).toFixed(2)} L${firstX.toFixed(2)},${(H - PAD_Y).toFixed(2)} Z`);
    }
    return { stroke: segs.join(" "), area: areaSegs.join(" ") };
  }, [curve, smoothed, fromSec, toSec, midMidi]);

  const playheadX = timeToX(Math.max(fromSec, Math.min(toSec, currentTime)));

  // Live mic dot
  let micY: number | null = null;
  let micColor = "var(--color-accent-vocal)";
  if (Number.isFinite(micHz) && curve && smoothed) {
    let myMidi = hzToMidi(micHz);
    // Octave-fold mic toward target
    const lo = Math.floor((currentTime - curve.fromSec) / curve.hopSec);
    const hi = lo + 1;
    let targetHz = NaN;
    if (lo >= 0 && hi < curve.times.length) {
      const a = smoothed[lo];
      const b = smoothed[hi];
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const frac = (currentTime - curve.times[lo]) / (curve.times[hi] - curve.times[lo]);
        targetHz = a + (b - a) * frac;
      }
    }
    if (Number.isFinite(targetHz)) {
      const targetMidi = hzToMidi(targetHz);
      while (myMidi - targetMidi > 6) myMidi -= 12;
      while (targetMidi - myMidi > 6) myMidi += 12;
      const cents = Math.abs(centsDelta(micHz, targetHz, true));
      if (cents < 25) micColor = "var(--color-accent-success)";
      else if (cents < 50) micColor = "#D9A53B";
      else micColor = "var(--color-accent-warn)";
    }
    micY = midiToY(myMidi);
    micY = Math.max(PAD_Y, Math.min(H - PAD_Y, micY));
  }

  const gradientId = "pitch-fill";

  return (
    <div className="bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] px-2 py-2 mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#CB6E3F" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#CB6E3F" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Subtle median reference line */}
        <line
          x1="0"
          y1={H / 2}
          x2={W}
          y2={H / 2}
          stroke="#E5E1D5"
          strokeWidth="0.5"
          strokeDasharray="2,4"
        />

        {/* Soft fill under the curve */}
        {area && <path d={area} fill={`url(#${gradientId})`} />}

        {/* Smooth vocal envelope */}
        {stroke && (
          <path
            d={stroke}
            fill="none"
            stroke="#993C1D"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.92"
          />
        )}

        {/* Playhead */}
        <line x1={playheadX} y1="0" x2={playheadX} y2={H} stroke="#2C2C2A" strokeWidth="0.6" opacity="0.35" />

        {/* Live mic dot */}
        {micActive && micY !== null && (
          <>
            <circle cx={playheadX} cy={micY} r="10" fill={micColor} opacity="0.18" />
            <circle cx={playheadX} cy={micY} r="5" fill={micColor} stroke="white" strokeWidth="1.5" />
          </>
        )}
      </svg>

      {/* Score line */}
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
            <span>tap mic to start</span>
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
