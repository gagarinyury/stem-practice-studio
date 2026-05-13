"use client";

import {
  IconChevronLeft,
  IconChevronRight,
  IconArrowBarLeft,
  IconArrowBarRight,
  IconRefresh,
  IconRepeat,
  IconRepeatOff,
} from "@tabler/icons-react";
import type { LoopRange } from "./TrackView";

interface Props {
  loop: LoopRange;
  duration: number;
  enabled: boolean;
  tempo: number;
  pitch: number;
  processing: boolean;
  onLoopChange: (r: LoopRange) => void;
  onToggleEnabled: () => void;
  onTempoChange: (t: number) => void;
  onPitchChange: (p: number) => void;
  onReset: () => void;
  onClear: () => void;
}

const SHIFT_STEP = 0.5;
const EDGE_STEP = 0.25;

export const TEMPO_MIN = 0.5;
export const TEMPO_MAX = 1.2;
export const TEMPO_STEP = 0.05;
export const PITCH_MIN = -6;
export const PITCH_MAX = 6;
export const PITCH_STEP = 1;

export function LoopControls({
  loop,
  duration,
  enabled,
  tempo,
  pitch,
  processing,
  onLoopChange,
  onToggleEnabled,
  onTempoChange,
  onPitchChange,
  onReset,
  onClear,
}: Props) {
  const len = loop.to - loop.from;

  function shift(dir: -1 | 1) {
    const d = dir * SHIFT_STEP;
    let from = loop.from + d;
    let to = loop.to + d;
    if (from < 0) {
      to -= from;
      from = 0;
    }
    if (to > duration) {
      from -= to - duration;
      to = duration;
    }
    onLoopChange({ ...loop, from, to });
  }

  function moveEdge(edge: "A" | "B", dir: -1 | 1) {
    const d = dir * EDGE_STEP;
    if (edge === "A") {
      const from = Math.max(0, Math.min(loop.to - 0.2, loop.from + d));
      onLoopChange({ ...loop, from });
    } else {
      const to = Math.max(loop.from + 0.2, Math.min(duration, loop.to + d));
      onLoopChange({ ...loop, to });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Loop window */}
      <Group label="ФРАГМЕНТ">
        <div className="flex items-center justify-between bg-[var(--color-surface)] p-1.5 rounded border border-[var(--color-border-soft)] shadow-sm">
          <Stepper
            title="Сдвинуть ◄"
            onClick={() => shift(-1)}
            disabled={loop.from <= 0}
          >
            <IconChevronLeft size={14} />
          </Stepper>
          <div className="px-1 font-mono text-[10px] text-ink tabular-nums whitespace-nowrap text-center">
            {fmt(loop.from)} <span className="text-[var(--color-ink-faint)]">→</span> {fmt(loop.to)}
            <div className="text-[9px] text-[var(--color-accent-vocal)] font-bold mt-0.5 flex flex-col items-center">
              <span>{len.toFixed(1)}s</span>
              {loop.fromWordIdx != null && loop.toWordIdx != null && (
                <span className="text-[var(--color-ink-muted)] font-normal text-[8px] mt-px">
                  {Math.max(0, loop.toWordIdx - loop.fromWordIdx + 1)} слов
                </span>
              )}
            </div>
          </div>
          <Stepper
            title="Сдвинуть ►"
            onClick={() => shift(1)}
            disabled={loop.to >= duration}
          >
            <IconChevronRight size={14} />
          </Stepper>
        </div>
      </Group>

      <div className="flex gap-2">
        {/* A edge */}
        <Group label="НАЧАЛО">
          <div className="flex bg-[var(--color-surface)] rounded border border-[var(--color-border-soft)] shadow-sm p-1 gap-1">
            <Stepper title="A−" onClick={() => moveEdge("A", -1)} disabled={loop.from <= 0}>
              <IconArrowBarLeft size={12} />
            </Stepper>
            <Stepper title="A+" onClick={() => moveEdge("A", 1)} disabled={loop.from >= loop.to - 0.2}>
              <IconArrowBarRight size={12} />
            </Stepper>
          </div>
        </Group>

        {/* B edge */}
        <Group label="КОНЕЦ">
          <div className="flex bg-[var(--color-surface)] rounded border border-[var(--color-border-soft)] shadow-sm p-1 gap-1">
            <Stepper title="B−" onClick={() => moveEdge("B", -1)} disabled={loop.to <= loop.from + 0.2}>
              <IconArrowBarLeft size={12} />
            </Stepper>
            <Stepper title="B+" onClick={() => moveEdge("B", 1)} disabled={loop.to >= duration}>
              <IconArrowBarRight size={12} />
            </Stepper>
          </div>
        </Group>
      </div>

      <div className="h-px w-full bg-[var(--color-border-soft)] my-0.5" />

      {/* Tempo */}
      <Group label="ТЕМП">
        <div className="flex items-center justify-between bg-[var(--color-surface)] p-1.5 rounded border border-[var(--color-border-soft)] shadow-sm">
          <Stepper
            title="−"
            onClick={() => onTempoChange(clamp(tempo - TEMPO_STEP, TEMPO_MIN, TEMPO_MAX))}
            disabled={tempo <= TEMPO_MIN + 1e-6}
          >
            <span className="font-mono text-[12px] leading-none text-[var(--color-accent-warn)]">−</span>
          </Stepper>
          <div className="px-1 font-mono text-[11px] text-ink tabular-nums w-[40px] text-center font-bold">
            ×{tempo.toFixed(2)}
          </div>
          <Stepper
            title="+"
            onClick={() => onTempoChange(clamp(tempo + TEMPO_STEP, TEMPO_MIN, TEMPO_MAX))}
            disabled={tempo >= TEMPO_MAX - 1e-6}
          >
            <span className="font-mono text-[12px] leading-none text-[var(--color-accent-success)]">+</span>
          </Stepper>
        </div>
      </Group>

      {/* Pitch */}
      <Group label="ТОН">
        <div className="flex items-center justify-between bg-[var(--color-surface)] p-1.5 rounded border border-[var(--color-border-soft)] shadow-sm">
          <Stepper
            title="−1 st"
            onClick={() => onPitchChange(clamp(pitch - PITCH_STEP, PITCH_MIN, PITCH_MAX))}
            disabled={pitch <= PITCH_MIN}
          >
            <span className="font-mono text-[12px] leading-none text-[var(--color-accent-warn)]">−</span>
          </Stepper>
          <div className="px-1 font-mono text-[11px] text-ink tabular-nums w-[40px] text-center font-bold">
            {pitch === 0 ? "0" : `${pitch > 0 ? "+" : ""}${pitch}`} st
          </div>
          <Stepper
            title="+1 st"
            onClick={() => onPitchChange(clamp(pitch + PITCH_STEP, PITCH_MIN, PITCH_MAX))}
            disabled={pitch >= PITCH_MAX}
          >
            <span className="font-mono text-[12px] leading-none text-[var(--color-accent-success)]">+</span>
          </Stepper>
        </div>
      </Group>

      {/* Reset / toggle / clear */}
      <div className="flex flex-col gap-2 mt-1">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] text-[var(--color-ink-muted)]">ПОВТОР</span>
          <button
            type="button"
            onClick={onToggleEnabled}
            title={enabled ? "Выключить loop" : "Включить loop"}
            className={`px-2 py-1 rounded font-mono text-[10px] font-bold transition-all shadow-sm flex items-center gap-1 ${
              enabled
                ? "bg-[var(--color-accent-vocal)] text-white hover:bg-[var(--color-accent-vocal-700)]"
                : "bg-[var(--color-surface)] border border-[var(--color-border-soft)] text-[var(--color-ink-muted)] hover:text-ink"
            }`}
          >
            {enabled ? <IconRepeat size={12} /> : <IconRepeatOff size={12} />}
            {enabled ? "ВКЛ" : "ВЫКЛ"}
          </button>
        </div>

        <div className="flex gap-2 w-full">
          <button
            type="button"
            onClick={onReset}
            disabled={tempo === 1 && pitch === 0}
            className="flex-1 py-1 rounded border border-[var(--color-border-soft)] text-[var(--color-ink-muted)] hover:text-ink hover:bg-[var(--color-surface)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors flex items-center justify-center gap-1 font-mono text-[9px]"
            title="Сбросить темп/тон"
          >
            <IconRefresh size={12} /> СБРОС
          </button>
          <button
            type="button"
            onClick={onClear}
            className="flex-1 py-1 rounded border border-[var(--color-border-soft)] text-[var(--color-accent-warn)] hover:bg-[var(--color-accent-warn)]/10 transition-colors flex items-center justify-center gap-1 font-mono text-[9px]"
          >
            УБРАТЬ
          </button>
        </div>

        {processing && (
          <div className="text-center font-mono text-[9px] text-[var(--color-accent-vocal)] animate-pulse mt-1">
            обрабатываем…
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-mono text-[9px] font-bold tracking-widest text-[var(--color-ink-muted)] uppercase">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Stepper({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-7 h-7 flex items-center justify-center rounded border border-[var(--color-border-soft)] bg-[var(--color-paper)] text-ink hover:bg-[var(--color-accent-vocal-50)] hover:border-[var(--color-accent-vocal-100)] active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[var(--color-paper)] disabled:hover:border-[var(--color-border-soft)]"
    >
      {children}
    </button>
  );
}

function fmt(s: number): string {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v * 1000) / 1000));
}
