"use client";

/**
 * Smule-style piano-roll under the waveform. Target vocal is quantized
 * into note blobs (rectangles at integer MIDI positions); the singer's
 * mic is drawn as a colored dot tracking pitch in realtime, snapped to
 * the same grid so the comparison is visually obvious.
 *
 * Y-axis: ±RANGE_SEMI semitones around the chunk's median MIDI note.
 * X-axis: time mapped from [fromSec, toSec] to ribbon width.
 */
import { useMemo } from "react";
import {
  centsDelta,
  hzToMidi,
  quantizeToNotes,
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
const H = 100;
const RANGE_SEMI = 8; // ±8 semitones — fits an octave each way comfortably
const LANE_H = (H - 8) / (RANGE_SEMI * 2 + 1); // pixel height per semitone
const NOTE_RADIUS = 2;

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
  // Median MIDI = ribbon vertical center.
  const midMidi = useMemo(() => {
    if (!curve || curve.hz.length === 0) return 60;
    const valid: number[] = [];
    for (let i = 0; i < curve.hz.length; i++) {
      if (Number.isFinite(curve.hz[i])) valid.push(hzToMidi(curve.hz[i]));
    }
    if (valid.length === 0) return 60;
    valid.sort((a, b) => a - b);
    return Math.round(valid[Math.floor(valid.length / 2)]);
  }, [curve]);

  const notes = useMemo(
    () => (curve ? quantizeToNotes(curve, 0.08) : []),
    [curve],
  );

  const len = Math.max(0.001, toSec - fromSec);

  /** Map MIDI to Y center of its lane. Notes above midMidi go up. */
  function midiToY(midi: number): number {
    const dSemi = midi - midMidi;
    return H / 2 - dSemi * LANE_H;
  }

  /** Time → X. */
  function timeToX(t: number): number {
    return ((t - fromSec) / len) * W;
  }

  const playheadX = timeToX(Math.max(fromSec, Math.min(toSec, currentTime)));

  // Live mic position + color
  let micY: number | null = null;
  let micColor = "var(--color-accent-vocal)";
  if (Number.isFinite(micHz) && curve && curve.times.length > 0) {
    const myMidi = hzToMidi(micHz);
    micY = midiToY(myMidi);
    // Pull mic into octave nearest target
    const lo = Math.floor((currentTime - curve.fromSec) / curve.hopSec);
    const hi = lo + 1;
    let targetHz = NaN;
    if (lo >= 0 && hi < curve.times.length) {
      const a = curve.hz[lo];
      const b = curve.hz[hi];
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const frac =
          (currentTime - curve.times[lo]) / (curve.times[hi] - curve.times[lo]);
        targetHz = a + (b - a) * frac;
      }
    }
    if (Number.isFinite(targetHz)) {
      // Octave-wrap mic toward target so dot lives near the target lane
      let foldedMidi = myMidi;
      const targetMidi = hzToMidi(targetHz);
      while (foldedMidi - targetMidi > 6) foldedMidi -= 12;
      while (targetMidi - foldedMidi > 6) foldedMidi += 12;
      micY = midiToY(foldedMidi);
      const cents = Math.abs(centsDelta(micHz, targetHz, true));
      if (cents < 25) micColor = "var(--color-accent-success)";
      else if (cents < 50) micColor = "#D9A53B";
      else micColor = "var(--color-accent-warn)";
    }
    if (micY !== null) micY = Math.max(4, Math.min(H - 4, micY));
  }

  return (
    <div className="bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] px-2 py-2 mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full">
        {/* Lane stripes — alternating shaded rows for readability */}
        {Array.from({ length: RANGE_SEMI * 2 + 1 }).map((_, i) => {
          const semiOffset = i - RANGE_SEMI;
          const y = midiToY(midMidi + semiOffset) - LANE_H / 2;
          // Alternate every semitone but emphasize the center lane.
          const isCenter = semiOffset === 0;
          const fill = isCenter
            ? "#FAEEDA"
            : Math.abs(semiOffset) % 2 === 0
            ? "#FAF7F2"
            : "transparent";
          return (
            <rect
              key={i}
              x={0}
              y={y}
              width={W}
              height={LANE_H}
              fill={fill}
              opacity={isCenter ? 0.55 : 0.7}
            />
          );
        })}

        {/* Octave guides — thicker line above/below center at ±12 (out of view but
            we mark ±5 and ±7 for musical reference) */}
        {[5, 7].map((n) => (
          <g key={n}>
            <line
              x1="0"
              y1={midiToY(midMidi + n)}
              x2={W}
              y2={midiToY(midMidi + n)}
              stroke="#E5E1D5"
              strokeWidth="0.4"
              strokeDasharray="1,3"
            />
            <line
              x1="0"
              y1={midiToY(midMidi - n)}
              x2={W}
              y2={midiToY(midMidi - n)}
              stroke="#E5E1D5"
              strokeWidth="0.4"
              strokeDasharray="1,3"
            />
          </g>
        ))}

        {/* Note blobs — target vocal */}
        {notes.map((n, i) => {
          if (n.toSec <= fromSec || n.fromSec >= toSec) return null;
          const dSemi = n.midi - midMidi;
          if (Math.abs(dSemi) > RANGE_SEMI) return null;
          const x = timeToX(Math.max(fromSec, n.fromSec));
          const x2 = timeToX(Math.min(toSec, n.toSec));
          const w = Math.max(2, x2 - x);
          const y = midiToY(n.midi) - LANE_H / 2 + 1;
          const h = Math.max(3, LANE_H - 2);
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={NOTE_RADIUS}
              fill="#7C7770"
              opacity="0.85"
            />
          );
        })}

        {/* Playhead vertical bar */}
        <line
          x1={playheadX}
          y1="0"
          x2={playheadX}
          y2={H}
          stroke="#2C2C2A"
          strokeWidth="0.6"
          opacity="0.4"
        />

        {/* Live mic dot */}
        {micActive && micY !== null && (
          <>
            {/* Trailing soft glow */}
            <circle cx={playheadX} cy={micY} r="9" fill={micColor} opacity="0.18" />
            <circle cx={playheadX} cy={micY} r="5" fill={micColor} stroke="white" strokeWidth="1.5" />
          </>
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
          ) : notes.length === 0 ? (
            <span>no clear notes detected</span>
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
