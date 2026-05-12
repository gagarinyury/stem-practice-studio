"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconCheck, IconMicrophone } from "@tabler/icons-react";
import { patchProfile } from "@/lib/api";
import { getToken, getUser, setUser } from "@/lib/auth";
import { DEV, DEV_USER } from "@/lib/dev-user";
import { createMicTracker } from "@/lib/pitch";
import { requestMic, releaseMic } from "@/lib/mic";
import { hzToNote, hzToMidi, nameOf, inferVoiceType } from "@/lib/notes";
import { RangeStrip } from "@/components/warmup/RangeStrip";
import { ScreenShell } from "@/components/ui/ScreenShell";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { BackLink } from "@/components/ui/BackLink";
import { MonoSmall, ErrorText } from "@/components/ui/text";
import { TipBadge } from "@/components/ui/TipBadge";
import { t } from "@/lib/strings";

interface SustainedTracker {
  values: number[];
  current: string | null;
  pinned: string | null;
}

// Auto-commit as soon as both extremes are locked and span at least
// this many semitones — no idle wait, the lock mechanism already
// requires 1s of stability at each end.
const MIN_RANGE_SEMITONES = 3;

export default function OnboardingPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [tracker, setTracker] = useState<SustainedTracker>({ values: [], current: null, pinned: null });

  const ctxRef = useRef<AudioContext | null>(null);
  const trackerRef = useRef<{ stop: () => void } | null>(null);
  const committedRef = useRef(false);

  useEffect(() => () => stopRecording(), []);

  function stopRecording() {
    trackerRef.current?.stop();
    trackerRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== "closed") {
      ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null;
    releaseMic();
    setRecording(false);
  }

  async function startRecording() {
    setError(null);
    committedRef.current = false;
    setTracker({ values: [], current: null, pinned: null });
    let stream: MediaStream;
    try {
      stream = await requestMic();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`${t.warmupOnboarding.micDenied} — ${msg}`);
      return;
    }
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const mic = createMicTracker(ctx, stream);

    interface S { hz: number; t: number }
    const win: S[] = [];
    let stopped = false;
    let raf = 0;

    const tick = () => {
      if (stopped) return;
      const r = mic.read();
      const now = performance.now();
      if (r && Number.isFinite(r.hz)) {
        win.push({ hz: r.hz, t: now });
      }
      while (win.length && now - win[0].t > 1000) win.shift();

      const cur = r && Number.isFinite(r.hz) ? hzToNote(r.hz).name : null;

      let pinned: string | null = null;
      let pinnedMidi: number | null = null;
      if (win.length >= 12) {
        const midis = win.map((s) => hzToMidi(s.hz));
        const sorted = [...midis].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const allClose = midis.every((m) => Math.abs(m - median) < 0.5);
        if (allClose) {
          pinnedMidi = Math.round(median);
          pinned = nameOf(pinnedMidi);
        }
      }

      setTracker((prev) => {
        const values = pinnedMidi !== null ? [...prev.values, pinnedMidi] : prev.values;
        if (!committedRef.current && values.length > 0) {
          const lo = Math.min(...values);
          const hi = Math.max(...values);
          if (hi - lo >= MIN_RANGE_SEMITONES) {
            committedRef.current = true;
            queueMicrotask(() => autoCommit(lo, hi));
          }
        }
        return { values, current: cur, pinned };
      });

      raf = requestAnimationFrame(tick);
    };

    trackerRef.current = {
      stop: () => {
        stopped = true;
        cancelAnimationFrame(raf);
        mic.dispose();
      },
    };
    setRecording(true);
    raf = requestAnimationFrame(tick);
  }

  async function autoCommit(loMidi: number, hiMidi: number) {
    stopRecording();
    const low = nameOf(loMidi);
    const high = nameOf(hiMidi);
    const voiceType = inferVoiceType(low, high);
    setBusy(true);
    setError(null);
    // In dev with no token (offline backend / unauth'd dev tour), persist
    // to localStorage only so the rest of the flow stays usable.
    if (DEV && !getToken()) {
      const base = getUser() ?? DEV_USER;
      setUser({ ...base, voice_low: low, voice_high: high, voice_type: voiceType });
      router.replace("/warmup");
      return;
    }
    try {
      const updated = await patchProfile({ voice_low: low, voice_high: high, voice_type: voiceType });
      setUser(updated);
      router.replace("/warmup");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      committedRef.current = false;
      setBusy(false);
    }
  }

  const liveLow = tracker.values.length ? nameOf(Math.min(...tracker.values)) : null;
  const liveHigh = tracker.values.length ? nameOf(Math.max(...tracker.values)) : null;

  return (
    <ScreenShell variant="flow">
      <div className="relative">
        <ScreenHeader
          eyebrow={t.warmupOnboarding.findingRange}
          title={t.warmupOnboarding.scanA}
          emphasis={t.warmupOnboarding.scanB}
          subtitle={
            <span className="whitespace-pre-line">{t.warmupOnboarding.hintScan}</span>
          }
        />
        <BackLink href="/warmup" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5">
        <div className="bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-[12px] p-4">
          <RangeStrip
            scaleLow="A2"
            scaleHigh="A4"
            low={liveLow}
            high={liveHigh}
            current={recording ? tracker.current : null}
          />
          <MonoSmall className="mt-2 block text-center">
            {busy
              ? `— ${t.common.loading} —`
              : recording
                ? tracker.pinned
                  ? <span className="text-[var(--color-accent-success)]">— {t.warmupOnboarding.locked}: {tracker.pinned} —</span>
                  : <>— {t.warmupOnboarding.listening}{tracker.current ? ` — ${tracker.current} ${t.warmupOnboarding.detected}` : "..."} —</>
                : `— ${t.warmupOnboarding.tapMicToStart} —`}
          </MonoSmall>
        </div>

        <TipBadge tone="warm" align="left">{t.warmupOnboarding.chestVoiceTip}</TipBadge>

        {error && <ErrorText>{error}</ErrorText>}

        <div className="flex flex-col items-center gap-3 pt-2">
          {!recording ? (
            <button
              type="button"
              onClick={startRecording}
              disabled={busy}
              className="w-20 h-20 rounded-full bg-[var(--color-accent-drill)] text-[var(--color-paper)] flex items-center justify-center disabled:opacity-50"
              aria-label={t.warmupOnboarding.startRecording}
            >
              <IconMicrophone size={28} />
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="w-20 h-20 rounded-full bg-[var(--color-accent-success)] text-[var(--color-paper)] flex items-center justify-center"
              aria-label={t.warmupOnboarding.stopRecording}
            >
              <IconCheck size={28} />
            </button>
          )}
          <MonoSmall>
            {recording ? t.warmupOnboarding.hintWhenRecording : t.warmupOnboarding.hintWhenIdle}
          </MonoSmall>
        </div>
      </div>
    </ScreenShell>
  );
}
