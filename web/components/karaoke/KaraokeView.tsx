"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconChevronDown,
  IconChevronRight,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconMicrophone2,
  IconMusic,
  IconPlayerPause,
  IconPlayerPlay,
  IconRepeat,
  IconRewindBackward15,
  IconRewindForward15,
} from "@tabler/icons-react";
import { StemEngine, type Spectrum } from "@/lib/audio-engine";
import type { AlignedLyrics, Manifest, StemKey } from "@/lib/manifest";
import { stemUrl } from "@/lib/manifest";
import { KaraokeSpectrum } from "./KaraokeSpectrum";
import { YouTubeBackground } from "./YouTubeBackground";
import { StemRow } from "@/components/player/StemRow";

function ytIdFromUrl(url: string): string | null {
  const m = url.match(/[?&]v=([\w-]{6,})/);
  if (m) return m[1];
  const short = url.match(/youtu\.be\/([\w-]{6,})/);
  return short ? short[1] : null;
}

const ALL_STEMS: StemKey[] = ["vocals", "drums", "bass", "guitar", "piano", "other"];
const SECONDARY: StemKey[] = ["drums", "bass", "guitar", "piano", "other"];
const SLOT_H = 54;
const STEM_ICON: Record<StemKey, typeof IconMusic> = {
  vocals: IconMicrophone2,
  drums: IconMusic,
  bass: IconMusic,
  guitar: IconMusic,
  piano: IconMusic,
  other: IconMusic,
};
const STEM_COLOR: Record<StemKey, [string, string]> = {
  vocals: ["#534AB7", "#AFA9EC"],
  drums: ["#C66857", "#E5B5AC"],
  bass: ["#BA7517", "#E0C49A"],
  guitar: ["#1D9E75", "#A6D7C5"],
  piano: ["#888780", "#C8C6BE"],
  other: ["#B4B2A9", "#D9D7CF"],
};

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

export function KaraokeView({ manifest, aligned }: Props) {
  const engineRef = useRef<StemEngine | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [spectrum, setSpectrum] = useState<Spectrum | null>(null);
  const [stemPeaks, setStemPeaks] = useState<Record<string, { left: Float32Array; right: Float32Array }>>({});
  const [muted, setMuted] = useState<Record<StemKey, boolean>>({
    vocals: false, drums: false, bass: false, guitar: false, piano: false, other: false,
  });
  const [solo, setSolo] = useState<StemKey | "instrum" | null>(null);
  const [vol, setVol] = useState<Record<StemKey, number>>({
    vocals: 0.85, drums: 0.7, bass: 0.7, guitar: 0.7, piano: 0.7, other: 0.7,
  });
  const [instrumVol, setInstrumVol] = useState(0.7);
  const [showAllStems, setShowAllStems] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showVideo, setShowVideo] = useState(true);
  const [cursorVisible, setCursorVisible] = useState(true);
  const ytId = useMemo(() => ytIdFromUrl(manifest.url), [manifest.url]);
  const cursorTimer = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;
    const engine = new StemEngine();
    engineRef.current = engine;
    setPhase("loading");
    engine
      .load(ALL_STEMS.map((key) => ({ key, url: stemUrl(manifest.id, manifest.stems[key]) })))
      .then(() => {
        if (stopped) return;
        for (const k of ALL_STEMS) engine.setVolume(k, vol[k]);
        setStemPeaks(engine.getStemPeaks(50));
        setPhase("ready");
      })
      .catch(() => {
        if (!stopped) setPhase("error");
      });
    return () => {
      stopped = true;
      engine.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const e = engineRef.current;
      if (e) {
        setCurrentTime(e.currentTime);
        setSpectrum({ ...e.tickSpectrum(140, 0.42) });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const reveal = () => {
      setCursorVisible(true);
      if (cursorTimer.current) window.clearTimeout(cursorTimer.current);
      cursorTimer.current = window.setTimeout(() => setCursorVisible(false), 2500);
    };
    reveal();
    window.addEventListener("mousemove", reveal);
    return () => {
      window.removeEventListener("mousemove", reveal);
      if (cursorTimer.current) window.clearTimeout(cursorTimer.current);
    };
  }, []);

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

  const applyGains = (
    nextMuted: Record<StemKey, boolean>,
    nextSolo: StemKey | "instrum" | null,
    nextVol: Record<StemKey, number>,
  ) => {
    const e = engineRef.current;
    if (!e) return;
    for (const k of ALL_STEMS) {
      let on = !nextMuted[k];
      if (nextSolo === "instrum") on = SECONDARY.includes(k);
      else if (nextSolo) on = k === nextSolo;
      e.setVolume(k, on ? nextVol[k] : 0);
    }
  };

  const toggleMute = (k: StemKey) => {
    const next = { ...muted, [k]: !muted[k] };
    setMuted(next);
    applyGains(next, solo, vol);
  };
  const toggleInstrumMute = () => {
    const allMuted = SECONDARY.every((k) => muted[k]);
    const next = { ...muted };
    for (const k of SECONDARY) next[k] = !allMuted;
    setMuted(next);
    applyGains(next, solo, vol);
  };
  const toggleSolo = (k: StemKey | "instrum") => {
    const next = solo === k ? null : k;
    setSolo(next);
    applyGains(muted, next, vol);
  };
  const setOneVol = (k: StemKey, v: number) => {
    const next = { ...vol, [k]: v };
    setVol(next);
    applyGains(muted, solo, next);
  };
  const setInstrumGroupVol = (v: number) => {
    setInstrumVol(v);
    const next = { ...vol };
    for (const k of SECONDARY) next[k] = v;
    setVol(next);
    applyGains(muted, solo, next);
  };

  const activeLine = useMemo(() => {
    let line = 0;
    for (const w of aligned.words) {
      if (w.start <= currentTime) line = w.line;
      else break;
    }
    return line;
  }, [aligned.words, currentTime]);

  const wordsByLine = useMemo(() => {
    const m = new Map<number, typeof aligned.words>();
    for (const w of aligned.words) {
      if (!m.has(w.line)) m.set(w.line, []);
      m.get(w.line)!.push(w);
    }
    return m;
  }, [aligned.words]);

  const cur = wordsByLine.get(activeLine);

  const dur = manifest.duration;
  const progress = phase === "ready" ? currentTime / Math.max(dur, 1) : 0;
  const titleClean = manifest.title.split("(")[0].split("Живой")[0].trim();
  const instrumPeaks = useMemo(() => {
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
    if (max > 0) for (let i = 0; i < len; i++) { left[i] /= max; right[i] /= max; }
    return { left, right };
  }, [stemPeaks]);

  return (
    <div
      style={{ cursor: cursorVisible ? "auto" : "none" }}
      className="fixed inset-0 flex bg-paper text-ink select-none"
    >
      {/* Stage (lyrics + spectrum) */}
      <div
        onClick={togglePlay}
        className="relative flex flex-1 cursor-pointer flex-col overflow-hidden"
      >
        {showVideo && ytId && (
          <>
            <YouTubeBackground videoId={ytId} currentTime={currentTime} playing={playing} />
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "linear-gradient(to bottom, rgba(250,247,242,0.20) 0%, rgba(250,247,242,0.10) 35%, rgba(20,15,10,0.45) 70%, rgba(20,15,10,0.85) 100%)",
              }}
            />
          </>
        )}
        <div className="relative flex flex-1 flex-col">
        {/* Top label — title + artist live here */}
        <div className="flex items-start justify-between gap-6 px-12 pt-8">
          <div
            className="relative inline-flex flex-col rounded-[14px] px-4 py-2"
            style={
              showVideo
                ? {
                    backdropFilter: "blur(18px) saturate(1.1)",
                    WebkitBackdropFilter: "blur(18px) saturate(1.1)",
                    background: "rgba(20,15,10,0.35)",
                    boxShadow: "0 0 30px rgba(0,0,0,0.3)",
                    textShadow: "0 0 8px rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,0.7)",
                  }
                : {}
            }
          >
            <div
              className="font-mono text-[10px] uppercase tracking-[0.25em]"
              style={{ color: showVideo ? "rgba(250,247,242,0.7)" : "var(--color-ink-muted)" }}
            >
              — now studying
            </div>
            <div
              className="mt-1 font-serif text-[24px] leading-[1.1]"
              style={{ color: showVideo ? "#FAF7F2" : "var(--color-ink)" }}
            >
              {titleClean}
            </div>
            <div
              className="mt-[2px] font-mono text-[11px] uppercase tracking-[0.15em]"
              style={{ color: showVideo ? "rgba(250,247,242,0.75)" : "var(--color-ink-muted)" }}
            >
              {manifest.artist}
            </div>
          </div>
          <div
            className="rounded-full px-3 py-2 font-mono text-[12px] uppercase tracking-[0.15em]"
            style={
              showVideo
                ? {
                    backdropFilter: "blur(18px) saturate(1.1)",
                    WebkitBackdropFilter: "blur(18px) saturate(1.1)",
                    background: "rgba(20,15,10,0.35)",
                    color: "rgba(250,247,242,0.92)",
                    textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                  }
                : { color: "var(--color-ink-muted)" }
            }
          >
            {fmt(currentTime)} / {fmt(dur)}
          </div>
        </div>

        {/* Spacer where video shines through */}
        <div className="flex-1" />

        {/* Lyrics — sliding reel with blur backdrop */}
        <div className={`relative mx-12 ${showVideo ? "mb-3" : "mb-6"}`}>
          {showVideo && (
            <div
              className="pointer-events-none absolute inset-x-[-2rem] inset-y-[-1rem] rounded-[24px]"
              style={{
                backdropFilter: "blur(18px) saturate(1.1)",
                WebkitBackdropFilter: "blur(18px) saturate(1.1)",
                background: "rgba(20,15,10,0.35)",
                boxShadow: "0 0 60px rgba(0,0,0,0.4)",
              }}
            />
          )}

          <div
            className="relative overflow-hidden"
            style={{
              height: SLOT_H * 3,
              maskImage: "linear-gradient(to bottom, transparent 0%, black 25%, black 75%, transparent 100%)",
              WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 25%, black 75%, transparent 100%)",
            }}
          >
            <div
              className="absolute left-0 right-0 flex flex-col items-center text-center transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                top: 0,
                transform: `translateY(${SLOT_H * 1 - activeLine * SLOT_H}px)`,
                textShadow: showVideo
                  ? "0 0 12px rgba(0,0,0,0.7), 0 2px 6px rgba(0,0,0,0.85)"
                  : undefined,
              }}
            >
              {aligned.lines.map((text, idx) => {
                const distance = Math.abs(idx - activeLine);
                const isActive = idx === activeLine;
                const fontSize = isActive ? 42 : distance === 1 ? 18 : 16;
                const opacity = showVideo
                  ? isActive ? 1 : distance === 1 ? 0.55 : 0.3
                  : isActive ? 1 : distance === 1 ? 0.55 : 0.3;
                const color = showVideo ? "#FAF7F2" : "var(--color-ink)";
                const lineWords = wordsByLine.get(idx);

                return (
                  <div
                    key={idx}
                    className={`flex items-center justify-center font-serif ${isActive ? "" : "italic"}`}
                    style={{
                      height: SLOT_H,
                      fontSize,
                      lineHeight: 1.1,
                      color,
                      opacity,
                      transition: "opacity 400ms ease, font-size 400ms ease",
                    }}
                  >
                    {isActive && lineWords?.length ? (
                      <span>
                        {lineWords.map((w, i) => {
                          const past = currentTime >= w.end;
                          const current = currentTime >= w.start && currentTime < w.end;
                          if (current) {
                            return (
                              <span
                                key={i}
                                className="rounded-[6px] px-2"
                                style={{ background: "#534AB7", color: "#FAF7F2", textShadow: "none" }}
                              >
                                {w.word}{" "}
                              </span>
                            );
                          }
                          return (
                            <span
                              key={i}
                              style={{
                                opacity: past ? 1 : 0.55,
                                transition: "opacity 200ms ease",
                              }}
                            >
                              {w.word}{" "}
                            </span>
                          );
                        })}
                      </span>
                    ) : (
                      <span>{text || " "}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Spectrum (hidden in video mode — video itself is the visual) */}
        {!showVideo && (
          <div
            className="relative px-12"
            style={{ height: 200 }}
            onClick={(e) => e.stopPropagation()}
          >
            <KaraokeSpectrum spectrum={spectrum} progress={progress} />
            <input
              type="range"
              min={0}
              max={dur}
              step={0.1}
              value={currentTime}
              onChange={(e) => seek(parseFloat(e.target.value))}
              className="absolute inset-x-12 top-0 h-full w-[calc(100%-6rem)] cursor-pointer opacity-0"
              style={{ WebkitAppearance: "none", appearance: "none", background: "transparent" }}
              aria-label="seek"
            />
          </div>
        )}

        {/* Footer */}
        <div className="px-12 pb-8" onClick={(e) => e.stopPropagation()}>
          {showVideo && (
            <input
              type="range"
              min={0}
              max={dur}
              step={0.1}
              value={currentTime}
              onChange={(e) => seek(parseFloat(e.target.value))}
              className="thin-range mb-3 w-full"
              aria-label="seek"
            />
          )}
          {(phase !== "ready" || (phase === "ready" && !playing)) && (
            <div className="flex justify-end">
              <div
                className="font-mono text-[11px] uppercase tracking-[0.15em]"
                style={{
                  color: showVideo ? "rgba(250,247,242,0.85)" : "var(--color-ink-muted)",
                  textShadow: showVideo ? "0 1px 2px rgba(0,0,0,0.6)" : undefined,
                }}
              >
                {phase === "loading"
                  ? "loading…"
                  : phase === "error"
                  ? "error"
                  : phase === "ready" && !playing
                  ? "click to play"
                  : ""}
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Top-right floating controls */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        {ytId && (
          <button
            onClick={() => setShowVideo((v) => !v)}
            className={`flex h-9 items-center gap-1 rounded-full border-[0.5px] border-border-soft bg-surface px-3 font-mono text-[10px] uppercase tracking-[0.15em] ${
              showVideo ? "text-ink" : "text-ink-muted hover:text-ink"
            }`}
            title="toggle video background"
          >
            {showVideo ? "video" : "no video"}
          </button>
        )}
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-full border-[0.5px] border-border-soft bg-surface text-ink-muted hover:text-ink"
          title={sidebarOpen ? "hide controls" : "show controls"}
        >
          {sidebarOpen ? (
            <IconLayoutSidebarRightCollapse size={18} stroke={1.5} />
          ) : (
            <IconLayoutSidebarRightExpand size={18} stroke={1.5} />
          )}
        </button>
      </div>

      {/* Right sidebar */}
      {sidebarOpen && (
        <aside className="flex w-[320px] shrink-0 flex-col gap-5 border-l-[0.5px] border-border-soft bg-surface-muted px-5 pb-6 pt-14">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
              — stems
            </div>
            <div className="mt-3 overflow-hidden rounded-[12px] border-[0.5px] border-border-soft bg-surface">
              <StemRow
                icon={<IconMicrophone2 size={14} className="text-accent-vocal" />}
                label="vocals"
                colorPlayed={STEM_COLOR.vocals[0]}
                colorRemain={STEM_COLOR.vocals[1]}
                progress={progress}
                volume={vol.vocals}
                muted={muted.vocals}
                soloed={solo === "vocals"}
                onVolume={(v) => setOneVol("vocals", v)}
                onToggleMute={() => toggleMute("vocals")}
                onToggleSolo={() => toggleSolo("vocals")}
                peaks={stemPeaks.vocals}
              />
              {!showAllStems && (
                <StemRow
                  icon={<IconMusic size={14} className="text-ink-muted" />}
                  label="music"
                  colorPlayed="#888780"
                  colorRemain="#B4B2A9"
                  progress={progress}
                  volume={instrumVol}
                  muted={SECONDARY.every((k) => muted[k])}
                  soloed={solo === "instrum"}
                  onVolume={setInstrumGroupVol}
                  onToggleMute={toggleInstrumMute}
                  onToggleSolo={() => toggleSolo("instrum")}
                  peaks={instrumPeaks}
                />
              )}
              {showAllStems &&
                SECONDARY.map((k, i) => {
                  const Icon = STEM_ICON[k];
                  const [played, remain] = STEM_COLOR[k];
                  return (
                    <StemRow
                      key={k}
                      icon={<Icon size={14} className="text-ink-muted" />}
                      label={k}
                      colorPlayed={played}
                      colorRemain={remain}
                      progress={progress}
                      volume={vol[k]}
                      muted={muted[k]}
                      soloed={solo === k}
                      onVolume={(v) => setOneVol(k, v)}
                      onToggleMute={() => toggleMute(k)}
                      onToggleSolo={() => toggleSolo(k)}
                      bordered={i < SECONDARY.length - 1}
                      peaks={stemPeaks[k]}
                    />
                  );
                })}
              <button
                onClick={() => setShowAllStems((v) => !v)}
                className="flex w-full items-center gap-[8px] px-3 py-2"
              >
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
                  {showAllStems ? "− hide split" : "+ split music"}
                </span>
                <span className="flex-1" />
                <IconChevronDown
                  size={14}
                  className={`text-ink-muted transition-transform ${showAllStems ? "rotate-180" : ""}`}
                />
              </button>
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
              — tempo · pitch
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border-[0.5px] border-border-soft bg-surface px-[11px] py-[5px] font-mono text-[11px] text-ink-faint" title="Phase 4: rubberband-wasm">
                ×1.00
              </span>
              <span className="rounded-full border-[0.5px] border-border-soft bg-surface px-[11px] py-[5px] font-mono text-[11px] text-ink-faint" title="Phase 4: rubberband-wasm">
                0 st
              </span>
              <span className="rounded-full border-[0.5px] border-border-soft bg-surface px-[11px] py-[5px] font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint" title="Phase 4">
                drill A–B
              </span>
            </div>
            <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.15em] text-ink-faint">
              phase 4 · rubberband-wasm
            </div>
          </div>

          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
              — transport
            </div>
            <div className="mt-3 flex items-center justify-between rounded-[12px] border-[0.5px] border-border-soft bg-surface px-3 py-3">
              <button onClick={() => seek(Math.max(0, currentTime - 15))} className="text-ink hover:opacity-80">
                <IconRewindBackward15 size={20} stroke={1.5} />
              </button>
              <button
                onClick={togglePlay}
                disabled={phase !== "ready"}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-ink disabled:opacity-50"
              >
                {playing ? (
                  <IconPlayerPause size={22} fill="#FAF7F2" className="text-paper" />
                ) : (
                  <IconPlayerPlay size={22} fill="#FAF7F2" className="text-paper" />
                )}
              </button>
              <button onClick={() => seek(Math.min(dur, currentTime + 15))} className="text-ink hover:opacity-80">
                <IconRewindForward15 size={20} stroke={1.5} />
              </button>
              <button className="text-ink-muted hover:text-ink" title="repeat (Phase 4)">
                <IconRepeat size={20} stroke={1.5} />
              </button>
            </div>
          </div>

          <div className="mt-auto pt-2">
            <a
              href={`/play/${manifest.id}`}
              className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted hover:text-ink"
            >
              compact player <IconChevronRight size={12} />
            </a>
          </div>
        </aside>
      )}
    </div>
  );
}
