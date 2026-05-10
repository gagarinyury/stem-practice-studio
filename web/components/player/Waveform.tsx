"use client";

interface Props {
  progress: number;
  colorPlayed: string;
  colorRemain: string;
  peaks?: { left: Float32Array; right: Float32Array } | null;
  level?: number;
}

const STEP = 4;
const BAR_W = 2;
const VIEW_W = 200;
const VIEW_H = 18;
const CENTER_Y = VIEW_H / 2;
const AMP_BOOST = 1.32;
const PULSE = 0.52;
const MAX_HALF_FACTOR = 1; // clamp to row half-height

export function Waveform({ progress, colorPlayed, colorRemain, peaks = null, level = 0 }: Props) {
  const buckets = peaks ? peaks.left.length : Math.floor(VIEW_W / STEP);
  const step = VIEW_W / buckets;
  const playX = progress * VIEW_W;
  const halfMax = (VIEW_H - 2) / 2;
  const playheadIdx = progress * buckets;
  const pulseRadius = Math.max(2, buckets * 0.08);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className="block h-[18px] w-full"
    >
      {Array.from({ length: buckets }, (_, i) => {
        const x = i * step;
        const isPlayed = x < playX;
        const fill = isPlayed ? colorPlayed : colorRemain;
        const lRaw = peaks?.left[i] ?? 0.4;
        const rRaw = peaks?.right[i] ?? 0.4;
        const dist = Math.abs(i - playheadIdx);
        const localFactor = Math.max(0, 1 - dist / pulseRadius);
        const liveBoost = 1 + level * PULSE * localFactor;
        const upH = Math.max(0.5, Math.min(halfMax * MAX_HALF_FACTOR, lRaw * halfMax * AMP_BOOST * liveBoost));
        const dnH = Math.max(0.5, Math.min(halfMax * MAX_HALF_FACTOR, rRaw * halfMax * AMP_BOOST * liveBoost));
        return (
          <g key={i}>
            <rect x={x} y={CENTER_Y - upH} width={BAR_W} height={upH} fill={fill} />
            <rect x={x} y={CENTER_Y} width={BAR_W} height={dnH} fill={fill} />
          </g>
        );
      })}
      <line x1={playX} y1={0} x2={playX} y2={VIEW_H} stroke="#2C2C2A" strokeWidth={1} />
    </svg>
  );
}
