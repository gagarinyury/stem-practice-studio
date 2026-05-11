"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconCheck, IconMicrophone, IconRotate } from "@tabler/icons-react";
import { patchProfile } from "@/lib/api";
import { setUser } from "@/lib/auth";
import { createMicTracker } from "@/lib/pitch";
import { requestMic, releaseMic } from "@/lib/mic";
import { hzToNote, hzToMidi, nameOf, inferVoiceType } from "@/lib/notes";
import { RangeStrip } from "@/components/warmup/RangeStrip";

type Step = "low" | "high" | "confirm";

interface SustainedTracker {
  /** All sustained MIDI notes captured this round. */
  values: number[];
  /** Latest detected note name for live UI. */
  current: string | null;
  /** The note we just locked in as sustained (lights up briefly). */
  pinned: string | null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("low");
  const [low, setLow] = useState<string | null>(null);
  const [high, setHigh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Track recording state for low/high steps
  const [recording, setRecording] = useState(false);
  const [tracker, setTracker] = useState<SustainedTracker>({ values: [], current: null, pinned: null });

  const ctxRef = useRef<AudioContext | null>(null);
  const trackerRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => () => stopRecording(), []); // cleanup on unmount

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

  async function startRecording(mode: "low" | "high") {
    setError(null);
    setTracker({ values: [], current: null, pinned: null });
    let stream: MediaStream;
    try {
      stream = await requestMic();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`microphone access denied — ${msg}`);
      return;
    }
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const mic = createMicTracker(ctx, stream);

    // Sliding 1-second window of (hz, t) samples.
    interface S { hz: number; t: number }
    const window: S[] = [];
    let stopped = false;
    let raf = 0;

    const tick = () => {
      if (stopped) return;
      const r = mic.read();
      const now = performance.now();
      if (r && Number.isFinite(r.hz)) {
        window.push({ hz: r.hz, t: now });
      }
      // drop > 1000ms old
      while (window.length && now - window[0].t > 1000) window.shift();

      // compute current note for UI
      const cur = r && Number.isFinite(r.hz) ? hzToNote(r.hz).name : null;

      // sustained = at least 12 samples (~600ms+) all within ±50 cents
      let pinned: string | null = null;
      if (window.length >= 12) {
        const midis = window.map((s) => hzToMidi(s.hz));
        const sorted = [...midis].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const allClose = midis.every((m) => Math.abs(m - median) < 0.5); // <50 cents
        if (allClose) {
          const noteMidi = Math.round(median);
          pinned = nameOf(noteMidi);
        }
      }

      setTracker((prev) => {
        const values = pinned
          ? (() => {
              const m = hzToMidi(window[Math.floor(window.length / 2)].hz);
              const noteMidi = Math.round(m);
              // Anti-falsetto for "high": ignore sustained that's >7 semitones above
              // the existing max — almost certainly a register break.
              if (mode === "high" && prev.values.length > 0) {
                const maxSoFar = Math.max(...prev.values);
                if (noteMidi - maxSoFar > 7) return prev.values; // skip
              }
              return [...prev.values, noteMidi];
            })()
          : prev.values;
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

  function commitRecording(mode: "low" | "high") {
    const vals = tracker.values;
    stopRecording();
    if (vals.length === 0) {
      setError("no clear note captured — try again");
      return;
    }
    const targetMidi = mode === "low" ? Math.min(...vals) : Math.max(...vals);
    const targetName = nameOf(targetMidi);
    if (mode === "low") {
      setLow(targetName);
      setStep("high");
    } else {
      setHigh(targetName);
      setStep("confirm");
    }
    setTracker({ values: [], current: null, pinned: null });
  }

  async function commitProfile() {
    if (!low || !high) return;
    setBusy(true);
    setError(null);
    try {
      const voiceType = inferVoiceType(low, high);
      const updated = await patchProfile({ voice_low: low, voice_high: high, voice_type: voiceType });
      setUser(updated);
      router.replace("/warmup");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  // Step indicator
  const stepIndex = { low: 0, high: 1, confirm: 2 }[step];

  function goBack() {
    stopRecording();
    setError(null);
    setTracker({ values: [], current: null, pinned: null });
    if (step === "high") { setLow(null); setStep("low"); }
    else if (step === "confirm") { setHigh(null); setStep("high"); }
  }

  return (
    <main className="flex-1 flex flex-col items-center px-4 pt-7 pb-10">
      <div className="w-full max-w-sm">
        {/* Stepper */}
        <div className="flex items-center justify-between">
          {step === "low" ? (
            <Link href="/warmup" className="font-mono text-[10px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">← back</Link>
          ) : (
            <button
              type="button"
              onClick={goBack}
              className="font-mono text-[10px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              ← back
            </button>
          )}
          <div className="flex gap-[6px]">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-6 h-[3px] rounded"
                style={{ background: i <= stepIndex ? "var(--color-accent-vocal)" : "#D3D1C7" }}
              />
            ))}
          </div>
        </div>

        {(step === "low" || step === "high") && (
          <section className="mt-6 text-center">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-accent-vocal)]">— finding your range —</div>
            <h1 className="mt-2 text-[30px] italic leading-tight">
              {step === "low"
                ? <>Now go <em className="not-italic text-[var(--color-ink-muted)]">down.</em></>
                : <>Now go <em className="not-italic text-[var(--color-ink-muted)]">up.</em></>}
            </h1>
            <p className="mt-3 font-mono text-[11px] text-[var(--color-ink-muted)] leading-relaxed">
              {step === "low"
                ? <>slide your voice down on &ldquo;oo&rdquo;<br />stop when it stops feeling natural</>
                : <>slide your voice up on &ldquo;ah&rdquo;<br />stop the moment it strains or breaks</>}
            </p>

            <div className="mt-6 bg-white border border-[var(--color-border-soft)] rounded-[12px] p-4">
              <RangeStrip
                scaleLow="A2"
                scaleHigh="A4"
                low={step === "low" ? (tracker.values.length ? nameOf(Math.min(...tracker.values)) : null) : low}
                high={step === "high" ? (tracker.values.length ? nameOf(Math.max(...tracker.values)) : null) : null}
                current={recording ? tracker.current : null}
              />
              <div className="mt-2 font-mono text-[10px] text-[var(--color-ink-muted)] tracking-[0.05em]">
                {recording
                  ? tracker.pinned
                    ? <span className="text-[var(--color-accent-success)]">— locked: {tracker.pinned} —</span>
                    : <>— listening{tracker.current ? ` — ${tracker.current} detected` : "..."} —</>
                  : "— tap mic to start —"}
              </div>
            </div>

            <div className="mt-5 bg-[#FAEEDA] rounded-[12px] p-3 flex gap-2 items-start text-left">
              <span className="font-mono text-[9px] uppercase text-[var(--color-accent-plan)] mt-1">!</span>
              <p className="text-[12px] italic leading-snug text-[#633806]">
                Sing in your <strong>chest voice</strong> — your normal speaking tone. No falsetto, no straining. Comfort wins.
              </p>
            </div>

            {error && <div className="mt-3 font-mono text-[11px] text-[var(--color-accent-warn)]">{error}</div>}

            <div className="mt-7 flex items-center justify-center gap-6">
              {!recording ? (
                <button
                  type="button"
                  onClick={() => startRecording(step)}
                  className="w-20 h-20 rounded-full bg-[var(--color-accent-warn)] text-[var(--color-paper)] flex items-center justify-center"
                  aria-label="start recording"
                >
                  <IconMicrophone size={28} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => commitRecording(step)}
                  className="w-20 h-20 rounded-full bg-[var(--color-accent-success)] text-[var(--color-paper)] flex items-center justify-center"
                  aria-label="i'm done"
                >
                  <IconCheck size={28} />
                </button>
              )}
            </div>
            <div className="mt-3 font-mono text-[10px] text-[var(--color-ink-muted)]">
              {recording ? "tap ✓ when you stop" : "tap mic, slide voice, then tap ✓"}
            </div>
          </section>
        )}

        {step === "confirm" && low && high && (
          <section className="mt-7 text-center">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-accent-success)]">— here it is —</div>
            <h1 className="mt-2 text-[30px] italic leading-tight">
              Your range: <em className="not-italic">{low}—{high}</em>
            </h1>
            <p className="mt-3 font-mono text-[11px] text-[var(--color-ink-muted)] leading-relaxed">
              voice type · <em className="italic">{inferVoiceType(low, high)}</em>
            </p>

            <div className="mt-6 bg-white border border-[var(--color-border-soft)] rounded-[12px] p-4">
              <RangeStrip scaleLow="A2" scaleHigh="A4" low={low} high={high} />
            </div>

            {error && <div className="mt-3 font-mono text-[11px] text-[var(--color-accent-warn)]">{error}</div>}

            <div className="mt-7 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => { setLow(null); setHigh(null); setStep("low"); }}
                className="inline-flex items-center gap-2 font-mono text-[11px] text-[var(--color-ink-muted)] border-b border-[var(--color-ink-faint)] pb-[2px]"
              >
                <IconRotate size={14} stroke={1.6} /> redo
              </button>
              <button
                type="button"
                onClick={commitProfile}
                disabled={busy}
                className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.15em] bg-[var(--color-ink)] text-[var(--color-paper)] py-4 px-6 rounded-pill disabled:opacity-50"
              >
                {busy ? "…" : <>save <IconCheck size={14} /></>}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
