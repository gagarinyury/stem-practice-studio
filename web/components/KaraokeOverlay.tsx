"use client";

import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { IconX, IconPlayerPlayFilled, IconPlayerPauseFilled } from "@tabler/icons-react";
import type { AlignedLyrics, AlignedWord, Manifest } from "@/lib/manifest";
import { videoUrl } from "@/lib/manifest";
import { useI18n } from "@/lib/i18n";

interface Props {
  manifest: Manifest;
  aligned: AlignedLyrics;
  currentTime: number;
  playing: boolean;
  vocalMuted: boolean;
  onTogglePlay: () => void;
  onToggleVocal: () => void;
  onSeek: (t: number) => void;
  onClose: () => void;
}

export function KaraokeOverlay({ manifest, aligned, currentTime, playing, vocalMuted, onTogglePlay, onToggleVocal, onSeek, onClose }: Props) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const duration = manifest.duration || aligned.duration || 0;
  const progressPct = duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;

  // Sync video time to our global currentTime, and play/pause state
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    // We only seek the video if it's drifting too far (e.g. > 0.3s)
    if (Math.abs(v.currentTime - currentTime) > 0.3) {
      v.currentTime = currentTime;
    }

    if (playing && v.paused) {
      v.play().catch(() => {
        // Video might not exist, or autoplay blocked, ignore error.
      });
    } else if (!playing && !v.paused) {
      v.pause();
    }
  }, [currentTime, playing]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      // TrackView already listens to Space for togglePlay, so we don't need to do it here unless we stop propagation
      // But since we are full screen, TrackView is still receiving keydown.
      // Actually, we don't need Space here if TrackView is handling it globally!
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle() {
    onTogglePlay();
  }

  const activeIdx = useMemo(() => {
    const w = aligned.words;
    if (!w.length) return -1;
    let lo = 0, hi = w.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (w[mid].start <= currentTime) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }, [aligned, currentTime]);

  // Window of 3 lines: prev / current / next
  const lineIdx = activeIdx >= 0 ? aligned.words[activeIdx].line : 0;
  const wordsByLine = useMemo(() => {
    const m = new Map<number, { w: AlignedWord; gi: number }[]>();
    aligned.words.forEach((w, i) => {
      if (!m.has(w.line)) m.set(w.line, []);
      m.get(w.line)!.push({ w, gi: i });
    });
    return m;
  }, [aligned]);

  function renderLine(li: number, emphasis: "current" | "side") {
    const ws = wordsByLine.get(li) ?? [];
    const klass =
      emphasis === "current"
        ? "text-[44px] leading-tight text-white"
        : "text-[24px] leading-tight text-white/45";
    return (
      <div key={li} className={`font-serif italic ${klass}`}>
        {ws.length === 0
          ? "—"
          : ws.map(({ w, gi }) => {
              const passed = gi <= activeIdx;
              const isActive = gi === activeIdx && emphasis === "current";
              return (
                <span
                  key={gi}
                  className={`inline-block px-1 ${
                    isActive
                      ? "text-white"
                      : passed
                      ? "text-white"
                      : emphasis === "current"
                      ? "text-white/55"
                      : ""
                  }`}
                >
                  {w.word}
                </span>
              );
            })}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <video
        ref={videoRef}
        src={videoUrl(manifest.id)}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        onError={(e) => {
          (e.target as HTMLVideoElement).style.display = 'none';
        }}
      />
      {/* Light gradient for text readability — no heavy darkening */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70 pointer-events-none" />

      {/* Clickable background for play/pause */}
      <div className="absolute inset-0 z-0" onClick={toggle} />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-6 py-4">
        <div>
          <div className="text-white text-[20px] font-serif italic leading-none">
            {manifest.title}
          </div>
          <div className="font-mono text-[10px] text-white/60 mt-1 tracking-[0.06em]">
            {manifest.artist}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-white/80 hover:text-white p-2"
          title="Esc"
        >
          <IconX size={22} />
        </button>
      </div>

      <div className="flex-1" />

      {/* Lyric reel */}
      <div className="relative z-10 px-12 pb-10 space-y-2">
        {renderLine(lineIdx - 1, "side")}
        {renderLine(lineIdx, "current")}
        {renderLine(lineIdx + 1, "side")}
      </div>

      {/* Bottom transport */}
      <div className="relative z-10 px-12 pb-10">
        <div className="mb-5 grid grid-cols-[48px_minmax(0,1fr)_48px] items-center gap-3">
          <div className="font-mono text-[11px] text-white/70 tabular-nums text-right">
            {fmtT(currentTime)}
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.01)}
            step={0.05}
            value={Math.min(currentTime, Math.max(duration, 0))}
            onChange={(e) => onSeek(Number(e.currentTarget.value))}
            className="karaoke-range w-full"
            style={{ "--karaoke-progress": `${progressPct}%` } as CSSProperties}
            aria-label={t("processing.position")}
          />
          <div className="font-mono text-[11px] text-white/45 tabular-nums">
            {fmtT(duration)}
          </div>
        </div>
        <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform"
        >
          {playing ? <IconPlayerPauseFilled size={24} /> : <IconPlayerPlayFilled size={24} />}
        </button>

        <button
          type="button"
          onClick={onToggleVocal}
          className={`px-4 h-12 rounded-full font-mono text-[13px] font-bold tracking-wider transition-all flex items-center gap-2 border ${
            vocalMuted
              ? "bg-[var(--color-accent-warn)]/20 text-[#ff6b6b] border-[#ff6b6b]/40"
              : "bg-white/10 text-white border-white/20 hover:bg-white/20"
          }`}
        >
          VOCALS {vocalMuted ? "OFF" : "ON"}
        </button>

        <div className="font-mono text-[12px] text-white/80 tabular-nums ml-2">
          {fmtT(currentTime)} / {fmtT(duration)}
        </div>
        <div className="ml-auto font-mono text-[10px] text-white/50 tracking-[0.08em]">
          SPACE play/pause · ESC exit
        </div>
        </div>
      </div>
    </div>
  );
}

function fmtT(s: number): string {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}
