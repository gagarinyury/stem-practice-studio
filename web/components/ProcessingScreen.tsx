"use client";

import { IconCheck, IconCircle, IconLoader2, IconMusic } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PhoneFrame } from "./ui/PhoneFrame";
import { getTrack, subscribeProgress, type ProgressEvent, type TrackSummary } from "@/lib/api";

const STAGES = [
  { key: "resolve_input", label: "Audio downloaded", endPct: 5 },
  { key: "separate", label: "Stem separation · 6 tracks", endPct: 70 },
  { key: "asr", label: "ASR · word-level timing", endPct: 85 },
  { key: "lrclib", label: "LRCLib lookup", endPct: 90 },
  { key: "align", label: "Alignment", endPct: 95 },
];

type StageKey = (typeof STAGES)[number]["key"];

export function ProcessingScreen({ id, initial }: { id: string; initial: TrackSummary | null }) {
  const router = useRouter();
  const [pct, setPct] = useState(0);
  const [activeStage, setActiveStage] = useState<StageKey>("resolve_input");
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<TrackSummary | null>(initial);

  useEffect(() => {
    // If already done at mount, jump immediately.
    if (initial?.status === "done") {
      router.replace(`/play/${id}`);
      return;
    }

    const stop = subscribeProgress(
      id,
      (e: ProgressEvent) => {
        if (typeof e.pct === "number") setPct(e.pct);
        if (e.stage === "error") setError(e.message || "pipeline error");
        if (e.stage && STAGES.find((s) => s.key === e.stage)) {
          // Stage event arrives *after* completion → mark next stage as active.
          const idx = STAGES.findIndex((s) => s.key === e.stage);
          const next = STAGES[idx + 1]?.key ?? STAGES[STAGES.length - 1].key;
          setActiveStage(next);
        }
      },
      (e: ProgressEvent) => {
        if (e.stage === "done") {
          router.replace(`/play/${id}`);
        } else if (e.stage === "error") {
          setError(e.message || "pipeline error");
          getTrack(id).then(setTrack).catch(() => {});
        }
      },
    );
    return stop;
  }, [id, initial, router]);

  function stageStatus(key: StageKey): "done" | "active" | "pending" {
    const idx = STAGES.findIndex((s) => s.key === key);
    const activeIdx = STAGES.findIndex((s) => s.key === activeStage);
    if (idx < activeIdx) return "done";
    if (idx === activeIdx) return "active";
    return "pending";
  }

  const title = track?.title || initial?.title || "Processing…";
  const meta = [track?.artist, track?.duration ? `${Math.round(track.duration / 60)}:${String(Math.round(track.duration % 60)).padStart(2, "0")}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <PhoneFrame>
      <div className="px-6 pt-6 flex items-center gap-3.5">
        <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-[#888780] to-[#2C2C2A] flex items-center justify-center">
          <IconMusic size={26} className="text-paper" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[22px] text-ink leading-[1.1] truncate">{title}</div>
          <div className="font-mono text-[11px] text-[var(--color-ink-muted)] mt-0.5">{meta || "—"}</div>
        </div>
      </div>

      <div className="px-6 pt-7">
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)] mb-3">
          — processing
        </div>

        {STAGES.map((s) => {
          const st = stageStatus(s.key);
          return (
            <div key={s.key} className="py-2.5">
              <div className="flex gap-2.5 items-center">
                {st === "done" && <IconCheck size={16} className="text-[var(--color-accent-success)]" />}
                {st === "active" && (
                  <IconLoader2 size={16} className="text-[var(--color-accent-vocal)] animate-spin" />
                )}
                {st === "pending" && <IconCircle size={16} className="text-[var(--color-ink-faint)]" />}
                <div
                  className={`flex-1 font-mono text-[13px] ${
                    st === "pending" ? "text-[var(--color-ink-muted)]" : "text-ink"
                  }`}
                >
                  {s.label}
                </div>
                {st === "active" && (
                  <span className="font-mono text-[11px] text-[var(--color-accent-vocal)]">
                    {Math.round(pct)}%
                  </span>
                )}
              </div>
              {st === "active" && (
                <div className="mt-2.5 h-[3px] bg-[#EEEDFE] rounded-[2px] overflow-hidden">
                  <div
                    className="h-full bg-[var(--color-accent-vocal)] transition-[width] duration-300"
                    style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error ? (
        <div className="px-6 py-7 text-center font-mono text-[11px] text-[var(--color-accent-warn)]">
          error: {error}
        </div>
      ) : (
        <div className="px-6 py-7 text-center font-mono text-[10px] text-[var(--color-ink-muted)]">
          feel free to leave — we&apos;ll be here when you&apos;re back
        </div>
      )}
    </PhoneFrame>
  );
}
