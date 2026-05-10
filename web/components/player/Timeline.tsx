"use client";

import type { Spectrum } from "@/lib/audio-engine";

interface Props {
  duration: number;
  currentTime: number;
  spectrum: Spectrum | null;
  onSeek: (t: number) => void;
}

const VIEW_W = 312;
const VIEW_H = 56;
const CENTER_Y = 28;
const BAR_W = 2;
const BUCKETS = 100;
const GAMMA = 0.77;
const AMP = 0.59;
const PULSE = 0.39;
const BASS_CUT = 0.07;

export function Timeline({ duration, currentTime, spectrum, onSeek }: Props) {
  const progress = Math.max(0, Math.min(1, currentTime / Math.max(duration, 1)));
  const playX = progress * VIEW_W;
  const halfMax = (VIEW_H - 4) / 2;
  const step = VIEW_W / BUCKETS;
  const cutoff = Math.floor(BASS_CUT * BUCKETS);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(ratio * duration);
  };

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className="block w-full cursor-pointer"
      style={{ height: 60 }}
      onClick={handleClick}
    >
      {Array.from({ length: BUCKETS }, (_, i) => {
        const x = i * step;
        const isPlayed = x < playX;
        const fill = isPlayed ? "#534AB7" : "#B4B2A9";
        const cutGain = cutoff > 0 ? Math.min(1, i / Math.max(1, cutoff)) : 1;
        const lvlL = spectrum?.left[i] ?? 0;
        const lvlR = spectrum?.right[i] ?? 0;
        const lH = Math.pow(lvlL * cutGain, GAMMA);
        const rH = Math.pow(lvlR * cutGain, GAMMA);
        const upH = Math.min(halfMax, Math.max(0.5, lH * halfMax * AMP * (1 + PULSE)));
        const dnH = Math.min(halfMax, Math.max(0.5, rH * halfMax * AMP * (1 + PULSE)));
        const peakLval = spectrum?.peakL[i] ?? 0;
        const peakRval = spectrum?.peakR[i] ?? 0;
        const pL = Math.min(halfMax, Math.pow(peakLval * cutGain, GAMMA) * halfMax * AMP * (1 + PULSE));
        const pR = Math.min(halfMax, Math.pow(peakRval * cutGain, GAMMA) * halfMax * AMP * (1 + PULSE));
        const capColor = isPlayed ? "#3C3489" : "#888780";
        return (
          <g key={i}>
            <rect x={x} y={CENTER_Y - upH} width={BAR_W} height={upH} fill={fill} />
            <rect x={x} y={CENTER_Y} width={BAR_W} height={dnH} fill={fill} />
            {pL > 1 && <rect x={x} y={CENTER_Y - pL - 1} width={BAR_W} height={0.8} fill={capColor} />}
            {pR > 1 && <rect x={x} y={CENTER_Y + pR + 0.2} width={BAR_W} height={0.8} fill={capColor} />}
          </g>
        );
      })}

      <line x1={0} y1={CENTER_Y} x2={VIEW_W} y2={CENTER_Y} stroke="#D3D1C7" strokeWidth={0.5} />
      <line x1={0} y1={CENTER_Y} x2={playX} y2={CENTER_Y} stroke="#534AB7" strokeWidth={1} />
      <circle cx={playX} cy={CENTER_Y} r={3.5} fill="#2C2C2A" />
    </svg>
  );
}
