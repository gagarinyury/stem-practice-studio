"use client";

import { useEffect, useState, type RefObject } from "react";
import {
  IconVolume,
  IconVolumeOff,
  IconHeadphones,
  IconHeadphonesOff,
  IconLoader2,
  IconDownload,
} from "@tabler/icons-react";
import type { StemEngine } from "@/lib/audio-engine";
import type { StemKey } from "@/lib/manifest";
import { useI18n, type I18nKey } from "@/lib/i18n";
import { exportStems, slugifyForFile } from "@/lib/export-stems";

interface Props {
  engineRef: RefObject<StemEngine | null>;
  stems: StemKey[];
  ready: boolean;
  vocalsMuted?: boolean;
  onToggleVocals?: () => void;
  isExpanded?: boolean;
  isExpanding?: boolean;
  onExpand?: () => void;
  trackTitle?: string;
}

const LABEL_KEY: Record<StemKey, I18nKey> = {
  vocals: "stems.vocals",
  drums: "stems.drums",
  bass: "stems.bass",
  guitar: "stems.guitar",
  piano: "stems.piano",
  other: "stems.other",
  music: "stems.music",
};

interface StemState {
  volume: number;
  muted: boolean;
}

export function StemMixer({ engineRef, stems, ready, vocalsMuted, onToggleVocals, isExpanded, isExpanding, onExpand, trackTitle }: Props) {
  const { t } = useI18n();
  const [state, setState] = useState<Record<string, StemState>>(() =>
    Object.fromEntries(stems.map((k) => [k, { volume: 1, muted: false }])),
  );

  // Keep state in sync when the stems list grows (e.g. user clicks "ВСЕ ДОРОЖКИ"):
  // without this, toggleMute on newly-added stems silently returns because state[key] is undefined.
  useEffect(() => {
    setState((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of stems) {
        if (!next[k]) {
          next[k] = { volume: 1, muted: false };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [stems]);

  const [solo, setSolo] = useState<string | null>(null);
  // Internal expanded toggle (used when no external expand control is provided)
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = isExpanded ?? localExpanded;
  const [instVol, setInstVol] = useState(1);
  const [instMuted, setInstMuted] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedExport, setSelectedExport] = useState<Set<string>>(() => new Set(stems));

  useEffect(() => {
    setSelectedExport((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const k of stems) {
        if (!next.has(k)) {
          next.add(k);
          changed = true;
        }
      }
      for (const k of Array.from(next)) {
        if (!stems.includes(k as StemKey)) {
          next.delete(k);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [stems]);

  function toggleExportKey(key: string) {
    setSelectedExport((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function applyExportPreset(preset: "all" | "instrumental" | "acapella") {
    if (preset === "all") setSelectedExport(new Set(stems));
    else if (preset === "instrumental") setSelectedExport(new Set(stems.filter((k) => k !== "vocals")));
    else setSelectedExport(new Set(stems.filter((k) => k === "vocals")));
  }

  async function handleExport() {
    const engine = engineRef.current;
    if (!engine || !ready || exporting || selectedExport.size === 0) return;
    setExporting(true);
    try {
      const keys = stems.filter((k) => selectedExport.has(k));
      const hasVocals = keys.includes("vocals");
      const nonVocals = keys.filter((k) => k !== "vocals");
      const allNonVocals = stems.filter((k) => k !== "vocals");
      let suffix: string;
      if (keys.length === stems.length) suffix = "all";
      else if (hasVocals && nonVocals.length === 0) suffix = "acapella";
      else if (!hasVocals && nonVocals.length === allNonVocals.length) suffix = "instrumental";
      else suffix = "custom";
      await new Promise((r) => setTimeout(r, 0));
      await exportStems({
        engine,
        keys,
        suffix,
        titleSlug: slugifyForFile(trackTitle),
      });
    } catch (err) {
      console.error("export failed", err);
    } finally {
      setExporting(false);
    }
  }

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
          title={muted ? t("stems.enableTrack") : t("stems.disableTrack")}
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
            title={isSolo ? t("stems.removeSolo") : t("stems.soloOnly")}
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
          {t("stems.tracks")}
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
          {isExpanding ? t("stems.loading") : expanded ? t("stems.collapse") : t("stems.allTracks")}
        </button>
      </div>

      {hasVocals && renderTrack(
        "vocals",
        t(LABEL_KEY.vocals),
        state["vocals"]?.volume ?? 1,
        vocalsMuted ?? state["vocals"]?.muted ?? false,
        solo === "vocals",
        (v) => setVolume("vocals", v),
        onToggleVocals || (() => toggleMute("vocals")),
        () => toggleSolo("vocals")
      )}

      {!expanded && instKeys.length > 0 && renderTrack(
        "music",
        t(LABEL_KEY.music),
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
          LABEL_KEY[key as StemKey] ? t(LABEL_KEY[key as StemKey]) : key,
          state[key]?.volume ?? 1,
          state[key]?.muted ?? false,
          solo === key,
          (v) => setVolume(key, v),
          () => toggleMute(key),
          () => toggleSolo(key)
        )
      )}

      <div className="mt-3 pt-3 border-t border-[var(--color-border-soft)]">
        <button
          type="button"
          onClick={() => setExportOpen((v) => !v)}
          className="w-full flex items-center justify-between font-mono text-[9px] text-[var(--color-ink-faint)] tracking-widest uppercase hover:text-ink transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <IconDownload size={10} />
            {t("stems.export")}
          </span>
          <span className="text-[var(--color-ink-faint)]">{exportOpen ? "−" : "+"}</span>
        </button>

        {exportOpen && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex gap-1 flex-wrap">
              {(["all", "instrumental", "acapella"] as const).map((preset) => {
                const labelKey: I18nKey =
                  preset === "all"
                    ? "stems.exportPickAll"
                    : preset === "instrumental"
                      ? "stems.exportInstrumental"
                      : "stems.exportAcapella";
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyExportPreset(preset)}
                    disabled={!ready || exporting}
                    className="px-2 py-0.5 rounded border border-[var(--color-border-soft)] text-[9px] font-mono uppercase tracking-wider text-[var(--color-ink-muted)] hover:text-ink hover:border-[var(--color-ink-muted)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-0.5">
              {stems.map((key) => {
                const checked = selectedExport.has(key);
                const label = LABEL_KEY[key as StemKey] ? t(LABEL_KEY[key as StemKey]) : key;
                return (
                  <label
                    key={key}
                    className="flex items-center gap-2 px-1.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider text-ink cursor-pointer hover:bg-[var(--color-surface-muted)]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleExportKey(key)}
                      disabled={!ready || exporting}
                      className="accent-[var(--color-accent-vocal)]"
                    />
                    <span className="truncate">{label}</span>
                  </label>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleExport}
              disabled={!ready || exporting || selectedExport.size === 0}
              className="flex items-center justify-center gap-1.5 px-2 py-2 rounded border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-[10px] font-mono uppercase tracking-wider text-ink hover:border-[var(--color-ink-muted)] hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {exporting ? (
                <IconLoader2 size={11} className="animate-spin" />
              ) : (
                <IconDownload size={11} />
              )}
              <span>{exporting ? t("stems.exporting") : t("stems.exportDownload")}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
