"use client";

import type { Spectrum } from "@/lib/audio-engine";

interface Props {
  spectrum: Spectrum | null;
  progress: number;
}

const VIEW_W = 1000;
const VIEW_H = 240;
const CENTER_Y = VIEW_H / 2;
const BUCKETS = 140;
const GAMMA = 0.77;
const AMP = 0.59;
const PULSE = 0.39;
const BASS_CUT = 0.07;

export function KaraokeSpectrum({ spectrum, progress }: Props) {
  const playX = progress * VIEW_W;
  const halfMax = (VIEW_H - 16) / 2;
  const step = VIEW_W / BUCKETS;
  const cutoff = Math.floor(BASS_CUT * BUCKETS);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height: "100%" }}
    >
      <line x1={playX} y1={0} x2={playX} y2={VIEW_H} stroke="#2C2C2A" strokeWidth={1} opacity={0.4} />
      {Array.from({ length: BUCKETS }, (_, i) => {
        const x = i * step;
        const isPlayed = x < playX;
        const fill = isPlayed ? "#534AB7" : "#B4B2A9";
        const cutGain = cutoff > 0 ? Math.min(1, i / Math.max(1, cutoff)) : 1;
        const lvlL = spectrum?.left[i] ?? 0;
        const lvlR = spectrum?.right[i] ?? 0;
        const lH = Math.pow(lvlL * cutGain, GAMMA);
        const rH = Math.pow(lvlR * cutGain, GAMMA);
        const upH = Math.min(halfMax, Math.max(1, lH * halfMax * AMP * (1 + PULSE)));
        const dnH = Math.min(halfMax, Math.max(1, rH * halfMax * AMP * (1 + PULSE)));
        const peakLval = spectrum?.peakL[i] ?? 0;
        const peakRval = spectrum?.peakR[i] ?? 0;
        const pL = Math.min(halfMax, Math.pow(peakLval * cutGain, GAMMA) * halfMax * AMP * (1 + PULSE));
        const pR = Math.min(halfMax, Math.pow(peakRval * cutGain, GAMMA) * halfMax * AMP * (1 + PULSE));
        const capColor = isPlayed ? "#3C3489" : "#888780";
        return (
          <g key={i}>
            <rect x={x} y={CENTER_Y - upH} width={4} height={upH} fill={fill} />
            <rect x={x} y={CENTER_Y} width={4} height={dnH} fill={fill} />
            {pL > 2 && <rect x={x} y={CENTER_Y - pL - 3} width={4} height={2} fill={capColor} />}
            {pR > 2 && <rect x={x} y={CENTER_Y + pR + 1} width={4} height={2} fill={capColor} />}
          </g>
        );
      })}
    </svg>
  );
}
