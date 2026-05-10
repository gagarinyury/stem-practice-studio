"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconChevronDown,
  IconDots,
  IconMicrophone2,
  IconMusic,
  IconPlayerPause,
  IconPlayerPlay,
  IconRepeat,
  IconRewindBackward15,
  IconRewindForward15,
} from "@tabler/icons-react";
import { StemRow } from "./StemRow";
import { LyricView } from "./LyricView";
import { Timeline } from "./Timeline";
import { StemEngine, type Spectrum } from "@/lib/audio-engine";
import type { AlignedLyrics, Manifest, StemKey } from "@/lib/manifest";
import { stemUrl } from "@/lib/manifest";

const ALL_STEMS: StemKey[] = ["vocals", "drums", "bass", "guitar", "piano", "other"];
const SECONDARY: StemKey[] = ["drums", "bass", "guitar", "piano", "other"];

function fmt(t: number): string {
  if (!isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  manifest: Manifest;
  aligned: AlignedLyrics;
}

type Phase = "idle" | "loading" | "ready" | "error";

export function MultiStemPlayer({ manifest, aligned }: Props) {
  const engineRef = useRef<StemEngine | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [vocalsVol, setVocalsVol] = useState(0.8);
  const [instrumVol, setInstrumVol] = useState(0.6);
  const [showAll, setShowAll] = useState(false);
  const [perStemVol, setPerStemVol] = useState<Record<StemKey, number>>({
    vocals: 0.8, drums: 0.6, bass: 0.6, guitar: 0.6, piano: 0.6, other: 0.6,
  });
  const [spectrum, setSpectrum] = useState<Spectrum | null>(null);
  const [stemPeaks, setStemPeaks] = useState<Record<string, { left: Float32Array; right: Float32Array }>>({});
  const [muted, setMuted] = useState<Record<StemKey, boolean>>({
    vocals: false, drums: false, bass: false, guitar: false, piano: false, other: false,
  });
  const [solo, setSolo] = useState<StemKey | "instrum" | "vocals-group" | null>(null);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    let stopped = false;
    const engine = new StemEngine();
    engineRef.current = engine;

    setPhase("loading");
    engine
      .load(ALL_STEMS.map((key) => ({ key, url: stemUrl(manifest.id, manifest.stems[key]) })))
      .then(() => {
        if (stopped) return;
        engine.setVolume("vocals", vocalsVol);
        for (const k of SECONDARY) engine.setVolume(k, instrumVol);
        setStemPeaks(engine.getStemPeaks(50));
        setPhase("ready");
      })
      .catch((e: Error) => {
        if (!stopped) {
          setError(e.message);
          setPhase("error");
        }
      });

    return () => {
      stopped = true;
      engine.dispose();
    };
  }, [manifest]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const e = engineRef.current;
      if (e) {
        setCurrentTime(e.currentTime);
        setLevel(e.getLevel());
        setSpectrum({ ...e.tickSpectrum(100, 0.42) });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const applyGains = (
    nextMuted: Record<StemKey, boolean>,
    nextSolo: typeof solo,
  ) => {
    const e = engineRef.current;
    if (!e) return;
    for (const k of ALL_STEMS) {
      const isVocalGroup = k === "vocals";
      const isInstrumGroup = SECONDARY.includes(k);
      let on = !nextMuted[k];
      if (nextSolo === "vocals-group") on = isVocalGroup;
      else if (nextSolo === "instrum") on = isInstrumGroup;
      else if (nextSolo) on = k === (nextSolo as StemKey);
      const vol = k === "vocals" ? vocalsVol : instrumVol;
      const indiv = perStemVol[k];
      const target = showAll ? indiv : vol;
      e.setVolume(k, on ? target : 0);
    }
  };

  const toggleMute = (key: StemKey | "instrum" | "vocals-group") => {
    if (key === "vocals-group") {
      const next = { ...muted, vocals: !muted.vocals };
      setMuted(next);
      applyGains(next, solo);
    } else if (key === "instrum") {
      const allInstrumMuted = SECONDARY.every((k) => muted[k]);
      const next = { ...muted };
      for (const k of SECONDARY) next[k] = !allInstrumMuted;
      setMuted(next);
      applyGains(next, solo);
    } else {
      const next = { ...muted, [key]: !muted[key] };
      setMuted(next);
      applyGains(next, solo);
    }
  };

  const toggleSolo = (key: StemKey | "instrum" | "vocals-group") => {
    const next = solo === key ? null : key;
    setSolo(next);
    applyGains(muted, next);
  };

  const togglePlay = () => {
    const e = engineRef.current;
    if (!e || phase !== "ready") return;
    e.toggle();
    setPlaying(e.state === "playing");
  };

  const seek = (t: number) => {
    engineRef.current?.seek(t);
    setCurrentTime(t);
  };

  const onVocalsVol = (v: number) => {
    setVocalsVol(v);
    engineRef.current?.setVolume("vocals", v);
    setPerStemVol((p) => ({ ...p, vocals: v }));
  };

  const onInstrumVol = (v: number) => {
    setInstrumVol(v);
    for (const k of SECONDARY) engineRef.current?.setVolume(k, v);
    setPerStemVol((p) => {
      const next = { ...p };
      for (const k of SECONDARY) next[k] = v;
      return next;
    });
  };

  const onSingleVol = (key: StemKey, v: number) => {
    engineRef.current?.setVolume(key, v);
    setPerStemVol((p) => ({ ...p, [key]: v }));
  };

  const dur = manifest.duration;
  const instrumPeaks = (() => {
    const keys = SECONDARY.filter((k) => stemPeaks[k]);
    if (keys.length === 0) return null;
    const len = stemPeaks[keys[0]].left.length;
    const left = new Float32Array(len);
    const right = new Float32Array(len);
    for (const k of keys) {
      const p = stemPeaks[k];
      for (let i = 0; i < len; i++) {
        left[i] += p.left[i];
        right[i] += p.right[i];
      }
    }
    let max = 0;
    for (let i = 0; i < len; i++) {
      left[i] /= keys.length;
      right[i] /= keys.length;
      if (left[i] > max) max = left[i];
      if (right[i] > max) max = right[i];
    }
    if (max > 0) {
      for (let i = 0; i < len; i++) {
        left[i] /= max;
        right[i] /= max;
      }
    }
    return { left, right };
  })();
  const titleClean = manifest.title.split("(")[0].split("Живой")[0].trim();
  const headerProgress = phase === "ready" ? currentTime / Math.max(dur, 1) : 0;

  return (
    <div className="flex min-h-screen items-start justify-center bg-surface-muted p-6">
      <div className="w-full max-w-[360px] overflow-hidden rounded-[28px] border-[0.5px] border-border-soft bg-paper font-serif">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-[18px]">
          <IconChevronDown size={22} stroke={1.5} className="text-ink" />
          <div className="text-center">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-muted">
              Now studying
            </div>
          </div>
          <IconDots size={22} stroke={1.5} className="text-ink" />
        </div>

        {/* Title */}
        <div className="px-6 pb-4 pt-2 text-center">
          <div className="text-[26px] leading-[1.1] text-ink">{titleClean}</div>
          <div className="mt-[2px] font-mono text-[11px] text-ink-muted">
            {manifest.artist} · {fmt(currentTime)} / {fmt(dur)}
          </div>
        </div>

        {/* Stems card */}
        <div className="px-5">
          <div className="overflow-hidden rounded-[12px] border-[0.5px] border-border-soft bg-surface">
            <StemRow
              icon={<IconMicrophone2 size={14} className="text-accent-vocal" />}
              label="vocals"
              colorPlayed="#534AB7"
              colorRemain="#AFA9EC"
              progress={headerProgress}
              volume={vocalsVol}
              muted={muted.vocals}
              soloed={solo === "vocals-group"}
              onVolume={onVocalsVol}
              onToggleMute={() => toggleMute("vocals-group")}
              onToggleSolo={() => toggleSolo("vocals-group")}
              peaks={stemPeaks.vocals}
              level={level}
            />
            {!showAll && (
              <StemRow
                icon={<IconMusic size={14} className="text-ink-muted" />}
                label="instrum."
                colorPlayed="#888780"
                colorRemain="#B4B2A9"
                progress={headerProgress}
                volume={instrumVol}
                muted={SECONDARY.every((k) => muted[k])}
                soloed={solo === "instrum"}
                onVolume={onInstrumVol}
                onToggleMute={() => toggleMute("instrum")}
                onToggleSolo={() => toggleSolo("instrum")}
                peaks={instrumPeaks}
                level={level}
              />
            )}
            {showAll &&
              SECONDARY.map((k, i) => (
                <StemRow
                  key={k}
                  icon={<IconMusic size={14} className="text-ink-muted" />}
                  label={k}
                  colorPlayed="#888780"
                  colorRemain="#B4B2A9"
                  progress={headerProgress}
                  volume={perStemVol[k]}
                  muted={muted[k]}
                  soloed={solo === k}
                  onVolume={(v) => onSingleVol(k, v)}
                  onToggleMute={() => toggleMute(k)}
                  onToggleSolo={() => toggleSolo(k)}
                  bordered={i < SECONDARY.length - 1}
                  peaks={stemPeaks[k]}
                  level={level}
                />
              ))}

            <button
              onClick={() => setShowAll((v) => !v)}
              className="flex w-full items-center gap-[10px] px-3 py-2 text-left"
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
                {showAll ? "− HIDE EXTRAS" : "+ DRUMS / BASS"}
              </span>
              <span className="flex-1" />
              <IconChevronDown
                size={14}
                className={`text-ink-muted transition-transform ${showAll ? "rotate-180" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* Lyrics */}
        <LyricView words={aligned.words} lines={aligned.lines} currentTime={currentTime} />

        {/* Timeline */}
        <div className="px-6 pt-[18px]">
          <Timeline duration={dur} currentTime={currentTime} spectrum={spectrum} onSeek={seek} />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-muted">
            <span>{fmt(currentTime)}</span>
            <span>{fmt(dur)}</span>
          </div>
        </div>

        {/* Transport */}
        <div className="flex items-center justify-between px-6 pb-2 pt-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full border-[0.5px] border-border-soft bg-surface px-[11px] py-[5px] font-mono text-[11px] text-ink">
              ×1.00
            </span>
            <span className="rounded-full border-[0.5px] border-border-soft bg-surface px-[11px] py-[5px] font-mono text-[11px] text-ink">
              0 st
            </span>
          </div>
          <div className="flex items-center gap-[14px]">
            <button onClick={() => seek(Math.max(0, currentTime - 15))}>
              <IconRewindBackward15 size={22} stroke={1.5} className="text-ink" />
            </button>
            <button
              onClick={togglePlay}
              disabled={phase !== "ready"}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-ink disabled:opacity-50"
            >
              {playing ? (
                <IconPlayerPause size={26} fill="#FAF7F2" className="text-paper" />
              ) : (
                <IconPlayerPlay size={26} fill="#FAF7F2" className="text-paper" />
              )}
            </button>
            <button onClick={() => seek(Math.min(dur, currentTime + 15))}>
              <IconRewindForward15 size={22} stroke={1.5} className="text-ink" />
            </button>
          </div>
          <button>
            <IconRepeat size={22} stroke={1.5} className="text-ink" />
          </button>
        </div>

        <div className="h-7" />

        {phase === "loading" && (
          <div className="px-6 pb-4 text-center font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
            loading stems…
          </div>
        )}
        {error && (
          <div className="px-6 pb-4 text-center font-mono text-[10px] text-accent-warn">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
