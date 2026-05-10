"use client";

import { midiOf, nameOf } from "@/lib/notes";

interface Props {
  /** Lowest note to render on the strip (e.g. "A2"). */
  scaleLow?: string;
  /** Highest note to render on the strip. */
  scaleHigh?: string;
  /** Optional pinned low marker (dark vertical line + label). */
  low?: string | null;
  /** Optional pinned high marker. */
  high?: string | null;
  /** Optional live "current" pulse marker. */
  current?: string | null;
}

/**
 * Horizontal SVG range strip. Used in onboarding (live current pulse) and
 * on the completion screen (compare profile vs today's peak).
 */
export function RangeStrip({
  scaleLow = "A2",
  scaleHigh = "A4",
  low = null,
  high = null,
  current = null,
}: Props) {
  const sLo = midiOf(scaleLow);
  const sHi = midiOf(scaleHigh);
  const span = Math.max(1, sHi - sLo);

  function xOf(note: string): number {
    const m = midiOf(note);
    if (Number.isNaN(m)) return -1;
    const t = (m - sLo) / span;
    return 10 + t * 300;
  }

  const tickNotes: string[] = [];
  for (let m = sLo; m <= sHi; m += 5) tickNotes.push(nameOf(m));

  const xLow = low ? xOf(low) : null;
  const xHigh = high ? xOf(high) : null;
  const xCur = current ? xOf(current) : null;

  return (
    <svg viewBox="0 0 320 90" className="w-full block">
      <line x1="10" y1="60" x2="310" y2="60" stroke="#D3D1C7" strokeWidth="0.5" />
      <g fontFamily="DM Mono, monospace" fontSize="9" fill="#888780">
        {tickNotes.map((n) => (
          <text key={n} x={xOf(n)} y="80" textAnchor="middle">{n}</text>
        ))}
      </g>
      <g stroke="#D3D1C7" strokeWidth="0.5">
        {tickNotes.map((n) => (
          <line key={n} x1={xOf(n)} y1="55" x2={xOf(n)} y2="65" />
        ))}
      </g>

      {xLow != null && xHigh != null && (
        <rect
          x={Math.min(xLow, xHigh)}
          y="52"
          width={Math.abs(xHigh - xLow)}
          height="16"
          rx="8"
          fill="#534AB7"
          opacity="0.18"
        />
      )}

      {xLow != null && (
        <g>
          <line x1={xLow} y1="40" x2={xLow} y2="68" stroke="#3C3489" strokeWidth="2" />
          <text x={xLow} y="32" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="10" fontWeight="500" fill="#3C3489">{low}</text>
          <text x={xLow} y="22" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="8" fill="#888780" letterSpacing="0.05em">low</text>
        </g>
      )}
      {xHigh != null && (
        <g>
          <line x1={xHigh} y1="40" x2={xHigh} y2="68" stroke="#3C3489" strokeWidth="2" />
          <text x={xHigh} y="32" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="10" fontWeight="500" fill="#3C3489">{high}</text>
          <text x={xHigh} y="22" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="8" fill="#888780" letterSpacing="0.05em">high</text>
        </g>
      )}
      {xCur != null && (
        <g>
          <circle cx={xCur} cy="60" r="9" fill="#FAF7F2" stroke="#1D9E75" strokeWidth="2.5">
            <animate attributeName="r" values="8;10;8" dur="1s" repeatCount="indefinite" />
          </circle>
          <circle cx={xCur} cy="60" r="4" fill="#1D9E75" />
          <text x={xCur} y="32" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="10" fontWeight="500" fill="#085041">{current}</text>
          <text x={xCur} y="22" textAnchor="middle" fontFamily="DM Mono, monospace" fontSize="8" fill="#1D9E75" letterSpacing="0.05em">now</text>
        </g>
      )}
    </svg>
  );
}
