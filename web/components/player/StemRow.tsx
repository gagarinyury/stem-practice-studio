"use client";

import { ReactNode } from "react";
import { Waveform } from "./Waveform";

interface Props {
  icon: ReactNode;
  label: string;
  colorPlayed: string;
  colorRemain: string;
  progress: number;
  volume: number;
  muted: boolean;
  soloed: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  bordered?: boolean;
  peaks?: { left: Float32Array; right: Float32Array } | null;
  level?: number;
}

export function StemRow({
  icon,
  label,
  colorPlayed,
  colorRemain,
  progress,
  volume,
  muted,
  soloed,
  onVolume,
  onToggleMute,
  onToggleSolo,
  bordered = true,
  peaks = null,
  level = 0,
}: Props) {
  const fadedPlayed = muted ? "#B4B2A9" : colorPlayed;
  const fadedRemain = muted ? "#D3D1C7" : colorRemain;

  return (
    <div
      className={`flex items-center gap-[8px] px-3 py-2 ${
        bordered ? "border-b-[0.5px] border-border-soft" : ""
      } ${muted ? "opacity-60" : ""}`}
    >
      <button
        onClick={onToggleMute}
        title={muted ? "unmute" : "mute"}
        className="flex w-[14px] items-center justify-center"
      >
        {icon}
      </button>
      <span className={`w-[52px] font-mono text-[10px] ${muted ? "line-through text-ink-muted" : "text-ink"}`}>
        {label}
      </span>
      <div className="flex-1">
        <Waveform progress={progress} colorPlayed={fadedPlayed} colorRemain={fadedRemain} peaks={peaks} level={level} />
      </div>
      <button
        onClick={onToggleSolo}
        title="solo"
        className={`font-mono text-[9px] uppercase tracking-[0.1em] ${
          soloed ? "text-accent-vocal" : "text-ink-muted hover:text-ink"
        }`}
      >
        S
      </button>
      <button
        onClick={onToggleMute}
        title={muted ? "unmute" : "mute"}
        className={`font-mono text-[9px] uppercase tracking-[0.1em] ${
          muted ? "text-accent-warn" : "text-ink-muted hover:text-ink"
        }`}
      >
        M
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onChange={(e) => onVolume(parseInt(e.target.value) / 100)}
        className="thin-range w-[44px]"
      />
    </div>
  );
}
