"use client";

import { IconCheck, IconCircle, IconLoader2 } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ScreenShell } from "./ui/ScreenShell";
import { ScreenHeader } from "./ui/ScreenHeader";
import { Label, MonoSmall, ErrorText } from "./ui/text";
import { getTrack, subscribeProgress, type ProgressEvent, type TrackSummary } from "@/lib/api";
import { t } from "@/lib/strings";

// startPct = where bar sits when stage begins; endPct = where it snaps when stage emits done.
// etaSec is the typical wall-clock duration of the stage — used to interpolate progress
// inside the stage so the bar moves smoothly instead of standing still for ~60s on separate.
// minSec is a floor: even if the backend finishes early, hold the stage on screen for at
// least this long so the user sees the milestone (e.g. download is often instant).
// phases (optional) — rotate the label through these sub-steps as the bar fills.
interface Stage {
  key: string;
  label: string;
  startPct: number;
  endPct: number;
  etaSec: number;
  minSec?: number;
  phases?: string[];
}

const STAGES: Stage[] = [
  { key: "resolve_input", label: "Downloading audio",        startPct: 0,   endPct: 20, etaSec: 25, minSec: 25 },
  {
    key: "separate",
    label: "Stem separation",
    startPct: 20, endPct: 70, etaSec: 60, minSec: 12,
    phases: [
      "splitting channels",
      "isolating vocals",
      "extracting drums",
      "lifting bass",
      "pulling guitar · piano",
      "finishing up",
    ],
  },
  { key: "asr",           label: "ASR · word-level timing",    startPct: 70,  endPct: 90, etaSec: 30 },
  { key: "lrclib",        label: "LRCLib lookup",              startPct: 90,  endPct: 95, etaSec: 3  },
  { key: "align",         label: "Alignment",                  startPct: 95,  endPct: 99, etaSec: 1  },
];

type StageKey = (typeof STAGES)[number]["key"];

export function ProcessingScreen({ id, initial, preview = false }: { id: string; initial: TrackSummary | null; preview?: boolean }) {
  const router = useRouter();
  const [pct, setPct] = useState(0);
  const [activeStage, setActiveStage] = useState<StageKey>("resolve_input");
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<TrackSummary | null>(initial);

  const stageStartRef = useRef<number>(typeof performance !== "undefined" ? performance.now() : 0);
  const serverFloorRef = useRef<number>(0);
  const pendingStageRef = useRef<StageKey | null>(null);
  const pendingStageAtRef = useRef<number>(0);
  const [phaseLabel, setPhaseLabel] = useState<string | null>(null);

  // Smooth interpolation inside the active stage. Asymptotic easing — bar approaches
  // the stage's endPct but never reaches it until a real done event arrives.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const stage = STAGES.find((s) => s.key === activeStage);
      if (stage) {
        const elapsed = (performance.now() - stageStartRef.current) / 1000;
        const span = stage.endPct - stage.startPct;
        // 1 - exp(-t/eta): reaches ~63% of span at t=eta, ~95% at t=3·eta
        const eased = stage.startPct + span * (1 - Math.exp(-elapsed / stage.etaSec));
        // Cap at 99.5% of the span — leave a sliver for the real event to claim
        const capped = Math.min(stage.startPct + span * 0.995, eased);
        const target = Math.max(serverFloorRef.current, capped);
        setPct((prev) => (Math.abs(prev - target) < 0.05 ? prev : target));

        // Rotate sub-phase label by elapsed/etaSec slice.
        const localizedPhases = (t.processing.phases as Record<string, readonly string[] | undefined>)[stage.key];
        const phases = localizedPhases ?? stage.phases;
        if (phases && phases.length) {
          const idx = Math.min(
            phases.length - 1,
            Math.floor((elapsed / stage.etaSec) * phases.length),
          );
          const next = phases[idx];
          setPhaseLabel((prev) => (prev === next ? prev : next));
        } else {
          setPhaseLabel((prev) => (prev === null ? prev : null));
        }

        // Honor minimum dwell time — if server already finished this stage,
        // advance only after minSec elapsed.
        if (pendingStageRef.current && elapsed >= (stage.minSec ?? 0)) {
          const next = pendingStageRef.current;
          // Anchor next stage to when its backend event arrived — backend has been
          // working on it the whole time we were holding the previous stage.
          stageStartRef.current = pendingStageAtRef.current || performance.now();
          pendingStageRef.current = null;
          pendingStageAtRef.current = 0;
          serverFloorRef.current = Math.max(serverFloorRef.current, stage.endPct);
          setActiveStage(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeStage]);

  useEffect(() => {
    // If already done at mount, jump immediately.
    if (initial?.status === "done" && !preview) {
      router.replace(`/play/${id}`);
      return;
    }

    const stop = subscribeProgress(
      id,
      (e: ProgressEvent) => {
        if (typeof e.pct === "number") {
          serverFloorRef.current = Math.max(serverFloorRef.current, e.pct);
        }
        if (e.stage === "error") setError(e.message || "pipeline error");
        if (e.stage && STAGES.find((s) => s.key === e.stage)) {
          // Stage event arrives *after* completion. Defer the transition so the
          // RAF loop can honour minSec — gives short stages (instant download)
          // visible dwell time on screen.
          const idx = STAGES.findIndex((s) => s.key === e.stage);
          const next = (STAGES[idx + 1]?.key ?? STAGES[STAGES.length - 1].key) as StageKey;
          pendingStageRef.current = next;
          pendingStageAtRef.current = performance.now();
        }
      },
      (e: ProgressEvent) => {
        if (e.stage === "done") {
          if (!preview) router.replace(`/play/${id}`);
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

  const title = track?.title || initial?.title || t.processing.titleFallback;
  const meta = [track?.artist, track?.duration ? `${Math.round(track.duration / 60)}:${String(Math.round(track.duration % 60)).padStart(2, "0")}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <ScreenShell variant="flow">
      <ScreenHeader
        eyebrow={t.processing.eyebrow}
        title={t.processing.titleA}
        emphasis={t.processing.titleB}
      />

      <div className="flex flex-col gap-1">
        <p className="font-mono text-[14px] leading-snug text-[var(--color-ink)] line-clamp-3">{title}</p>
        {meta && <MonoSmall>{meta}</MonoSmall>}
      </div>

      <div className="flex flex-col">
        <Label className="mb-3 block">— {t.processing.stageEyebrow}</Label>

        {STAGES.map((s) => {
          const st = stageStatus(s.key);
          const stageLabel = (t.processing.stages as Record<string, string>)[s.key] ?? s.label;
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
                  {st === "active" && phaseLabel ? (
                    <>
                      <span>{stageLabel}</span>
                      <span className="text-[var(--color-ink-muted)]"> · {phaseLabel}</span>
                    </>
                  ) : (
                    stageLabel
                  )}
                </div>
                {st === "active" && (
                  <span className="font-mono text-[11px] text-[var(--color-accent-vocal)]">
                    {Math.round(pct)}%
                  </span>
                )}
              </div>
              {st === "active" && (
                <div className="mt-2.5 h-[3px] bg-[var(--color-surface-muted)] rounded-[2px] overflow-hidden">
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

      <div className="mt-auto text-center">
        {error ? (
          <ErrorText>{t.processing.errorPrefix}: {error}</ErrorText>
        ) : (
          <MonoSmall>{t.processing.leaveHint}</MonoSmall>
        )}
      </div>
    </ScreenShell>
  );
}
