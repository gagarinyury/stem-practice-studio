import { useEffect, useState } from "react";
import { subscribeProgress, type TrackSummary, type ProgressEvent } from "@/lib/api";
import { useI18n, type I18nKey } from "@/lib/i18n";

const STAGE_KEYS: Record<string, I18nKey> = {
  queued: "processing.stage.queued",
  resolve_input: "processing.stage.resolve_input",
  identify: "processing.stage.identify",
  separate: "processing.stage.separate",
  asr: "processing.stage.asr",
  lrclib: "processing.stage.lrclib",
  align: "processing.stage.align",
  manifest: "processing.stage.manifest",
  done: "processing.stage.done",
};

interface Props {
  track: TrackSummary;
  onDone: () => void;
}

export function ProcessingScreen({ track, onDone }: Props) {
  const { t } = useI18n();
  const [event, setEvent] = useState<ProgressEvent | null>(null);

  useEffect(() => {
    let unmounted = false;
    const unsub = subscribeProgress(track.id, (ev) => {
      if (!unmounted) setEvent(ev);
    }, (ev) => {
      if (!unmounted && ev.stage === "done") {
        onDone();
      }
    });

    return () => {
      unmounted = true;
      unsub();
    };
  }, [track.id, onDone]);

  const pct = event?.pct ?? 0;
  const stage = event?.stage ?? track.status;
  const isError = stage === "error" || track.status === "failed";

  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--color-paper)] relative">
      <div className="max-w-md w-full px-8 flex flex-col items-center">
        <div className="w-16 h-16 rounded-2xl bg-[var(--color-surface)] shadow-sm border border-[var(--color-border-soft)] flex items-center justify-center mb-6 relative overflow-hidden">
          {!isError && (
            <div
              className="absolute bottom-0 left-0 right-0 bg-[var(--color-accent-vocal-100)] transition-all duration-300 ease-out"
              style={{ height: `${pct}%` }}
            />
          )}
          <svg className={`w-8 h-8 ${isError ? 'text-[var(--color-accent-warn)]' : 'text-[var(--color-accent-vocal)] animate-pulse'} relative z-10`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            {isError ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            )}
          </svg>
        </div>

        <h2 className="text-[20px] font-serif italic text-ink text-center mb-2">
          {track.title || t("processing.title")}
        </h2>

        {isError ? (
          <div className="text-[12px] font-mono text-[var(--color-accent-warn)] text-center">
            {event?.message || track.error || t("processing.defaultError")}
          </div>
        ) : (
          <>
            <div className="text-[12px] font-mono text-[var(--color-ink-muted)] text-center mb-6 h-4">
              {STAGE_KEYS[stage]
                ? t(STAGE_KEYS[stage])
                : t("processing.stage.unknown", { stage })}
            </div>

            <div className="w-full h-1 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--color-accent-vocal)] rounded-full transition-all duration-300 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
