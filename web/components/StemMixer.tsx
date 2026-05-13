"use client";

import { useState, type RefObject } from "react";
import {
  IconVolume,
  IconVolumeOff,
  IconHeadphones,
  IconHeadphonesOff,
  IconLoader2,
} from "@tabler/icons-react";
import type { StemEngine } from "@/lib/audio-engine";
import type { StemKey } from "@/lib/manifest";

interface Props {
  engineRef: RefObject<StemEngine | null>;
  stems: StemKey[];
  ready: boolean;
  vocalsMuted?: boolean;
  onToggleVocals?: () => void;
  isExpanded?: boolean;
  isExpanding?: boolean;
  onExpand?: () => void;
}

const LABEL: Record<StemKey, string> = {
  vocals: "Вокал",
  drums: "Ударные",
  bass: "Бас",
  guitar: "Гитара",
  piano: "Пиано",
  other: "Прочее",
  music: "Музыка",
};

interface StemState {
  volume: number;
  muted: boolean;
}

export function StemMixer({ engineRef, stems, ready, vocalsMuted, onToggleVocals, isExpanded, isExpanding, onExpand }: Props) {
  const [state, setState] = useState<Record<string, StemState>>(() =>
    Object.fromEntries(stems.map((k) => [k, { volume: 1, muted: false }])),
  );
  const [solo, setSolo] = useState<string | null>(null);
  // Internal expanded toggle (used when no external expand control is provided)
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = isExpanded ?? localExpanded;
  const [instVol, setInstVol] = useState(1);
  const [instMuted, setInstMuted] = useState(false);

  function setVolume(key: string, v: number) {
    const e = engineRef.current;
    e?.setVolume(key, v);
    setState((s) => ({ ...s, [key]: { volume: v, muted: v <= 0 } }));
    if (solo) setSolo(null);
  }

  function toggleMute(key: string) {
    const cur = state[key];
    if (!cur) return;
    const muted = !cur.muted;
    const e = engineRef.current;
    if (muted) e?.setMuted(key, true);
    else e?.setVolume(key, cur.volume || 1);
    setState((s) => ({ ...s, [key]: { volume: cur.volume || 1, muted } }));
    if (solo) setSolo(null);
  }

  function toggleSolo(key: string) {
    const e = engineRef.current;
    if (!e) return;
    if (solo === key) {
      setSolo(null);
      for (const k of stems) {
        const st = state[k];
        if (st?.muted) e.setMuted(k, true);
        else e.setVolume(k, st?.volume ?? 1);
      }
    } else {
      setSolo(key);
      e.setSolo(key);
    }
  }

  function setInstrumentalVolume(v: number) {
    setInstVol(v);
    setInstMuted(v <= 0);
    const e = engineRef.current;
    if (solo) setSolo(null);
    stems.filter(k => k !== "vocals").forEach(key => {
      e?.setVolume(key, v);
      setState(s => ({ ...s, [key]: { volume: v, muted: v <= 0 } }));
    });
  }

  function toggleInstrumentalMute() {
    const muted = !instMuted;
    setInstMuted(muted);
    const e = engineRef.current;
    if (solo) setSolo(null);
    stems.filter(k => k !== "vocals").forEach(key => {
      if (muted) e?.setMuted(key, true);
      else e?.setVolume(key, instVol || 1);
      setState(s => ({ ...s, [key]: { volume: instVol || 1, muted } }));
    });
  }

  function renderTrack(
    key: string,
    label: string,
    vol: number,
    muted: boolean,
    isSolo: boolean,
    onVolChange: (v: number) => void,
    onMute: () => void,
    onSolo?: () => void
  ) {
    const isMuted = solo ? !isSolo : muted;
    return (
      <div
        key={key}
        className={`flex items-center gap-2 px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-soft)] shadow-sm transition-opacity ${
          isMuted ? "opacity-50" : "hover:border-[var(--color-ink-muted)] hover:shadow-md"
        }`}
      >
        <div className="w-10 font-mono text-[9px] font-bold tracking-widest uppercase text-ink truncate" title={label}>
          {label}
        </div>
        <button
          type="button"
          disabled={!ready}
          onClick={onMute}
          title={muted ? "Включить дорожку" : "Выключить дорожку"}
          className={`p-1 rounded-full transition-colors ${
            muted
              ? "bg-[var(--color-accent-warn)]/10 text-[var(--color-accent-warn)]"
              : "text-[var(--color-ink-muted)] hover:text-ink hover:bg-[var(--color-surface-muted)]"
          }`}
        >
          {muted ? <IconVolumeOff size={12} /> : <IconVolume size={12} />}
        </button>
        {onSolo ? (
          <button
            type="button"
            disabled={!ready}
            onClick={onSolo}
            title={isSolo ? "Снять solo" : "Слушать только эту дорожку"}
            className={`p-1 rounded-full transition-colors ${
              isSolo
                ? "bg-[var(--color-accent-vocal)]/20 text-[var(--color-accent-vocal)]"
                : "text-[var(--color-ink-muted)] hover:text-ink hover:bg-[var(--color-surface-muted)]"
            }`}
          >
            {isSolo ? <IconHeadphones size={12} /> : <IconHeadphonesOff size={12} />}
          </button>
        ) : (
          <div className="w-[20px]" /> // placeholder for alignment
        )}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={vol}
          disabled={!ready}
          onChange={(e) => onVolChange(Number(e.target.value))}
          className="thin-range flex-1 min-w-0 ml-1"
        />
      </div>
    );
  }

  const hasVocals = stems.includes("vocals");
  const instKeys = stems.filter(k => k !== "vocals");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[9px] text-[var(--color-ink-faint)] tracking-widest uppercase">
          ДОРОЖКИ
        </span>
        <button
          onClick={() => {
            if (onExpand && !expanded) onExpand();
            else setLocalExpanded(!localExpanded);
          }}
          disabled={isExpanding}
          className="font-mono text-[9px] text-[var(--color-accent-vocal)] hover:underline disabled:opacity-50 flex items-center gap-1"
        >
          {isExpanding && <IconLoader2 size={10} className="animate-spin" />}
          {isExpanding ? "ЗАГРУЗКА…" : expanded ? "СВЕРНУТЬ" : "ВСЕ ДОРОЖКИ"}
        </button>
      </div>

      {hasVocals && renderTrack(
        "vocals",
        LABEL.vocals,
        state["vocals"]?.volume ?? 1,
        vocalsMuted ?? state["vocals"]?.muted ?? false,
        solo === "vocals",
        (v) => setVolume("vocals", v),
        onToggleVocals || (() => toggleMute("vocals")),
        () => toggleSolo("vocals")
      )}

      {!expanded && instKeys.length > 0 && renderTrack(
        "music",
        LABEL.music,
        instVol,
        instMuted,
        solo === "music",
        setInstrumentalVolume,
        toggleInstrumentalMute,
        () => toggleSolo("music")
      )}

      {expanded && instKeys.map((key) =>
        renderTrack(
          key,
          LABEL[key as StemKey] || key,
          state[key]?.volume ?? 1,
          state[key]?.muted ?? false,
          solo === key,
          (v) => setVolume(key, v),
          () => toggleMute(key),
          () => toggleSolo(key)
        )
      )}
    </div>
  );
}
