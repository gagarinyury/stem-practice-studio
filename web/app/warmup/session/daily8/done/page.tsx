"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconArrowRight, IconMusic } from "@tabler/icons-react";
import { listTracks, postWarmupSession, type TrackSummary } from "@/lib/api";
import { getUser } from "@/lib/auth";
import { RangeStrip } from "@/components/warmup/RangeStrip";

const LLM_URL = "http://evox2:8083/v1/chat/completions";

interface SessionResult {
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  stepsCompleted: number;
  stepsSkipped: number;
  language: string;
}

export default function DonePage() {
  const router = useRouter();
  const [result, setResult] = useState<SessionResult | null>(null);
  const [observation, setObservation] = useState<string>("thinking…");
  const [continueTrack, setContinueTrack] = useState<TrackSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem("warmup.lastResult") : null;
    if (!raw) {
      router.replace("/warmup");
      return;
    }
    let parsed: SessionResult;
    try {
      parsed = JSON.parse(raw) as SessionResult;
    } catch {
      router.replace("/warmup");
      return;
    }
    setResult(parsed);

    // Persist the session and run LLM in parallel.
    void persistAndObserve(parsed);
    void loadLastTrack();
  }, [router]);

  async function persistAndObserve(r: SessionResult) {
    try {
      await postWarmupSession({
        started_at: r.startedAt,
        finished_at: r.finishedAt,
        duration_sec: r.durationSec,
        steps_completed: r.stepsCompleted,
        steps_skipped: r.stepsSkipped,
      });
    } catch (e) {
      console.error("postWarmupSession failed", e);
      setError("could not save session");
    }
    try {
      const text = await fetchObservation(r);
      setObservation(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setObservation(`(could not reach LLM — ${msg})`);
    }
  }

  async function loadLastTrack() {
    try {
      const tracks = await listTracks();
      const done = tracks.filter((t) => t.status === "done");
      if (done.length) setContinueTrack(done[done.length - 1]);
    } catch {
      // not critical
    }
  }

  if (!result) {
    return <main className="flex-1 flex items-center justify-center font-mono text-[11px] text-[var(--color-ink-muted)]">…</main>;
  }

  const user = getUser();
  const minutes = Math.round(result.durationSec / 60);
  return (
    <main className="flex-1 flex flex-col items-center px-5 pt-10 pb-8 max-w-sm mx-auto w-full">
      <div className="w-full">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-success)]">— done · {minutes} min —</div>
        <h1 className="mt-3 text-[38px] leading-none">Voice is <em className="text-[var(--color-ink-muted)]">ready.</em></h1>
        <div className="mt-3 font-mono text-[12px] text-[var(--color-ink-muted)]">
          {user ? `streak day ${user.streak_count + (user.last_session_at ? 0 : 1)}` : ""}
        </div>

        {/* Range card */}
        {user?.voice_low && user?.voice_high && (
          <section className="mt-6 bg-white border border-[var(--color-border-soft)] rounded-[12px] p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)]">— your range</div>
            <RangeStrip scaleLow="A2" scaleHigh="A4" low={user.voice_low} high={user.voice_high} />
          </section>
        )}

        {/* Metrics */}
        <section className="mt-4 grid grid-cols-2 gap-2">
          <div className="bg-white border border-[var(--color-border-soft)] rounded-[10px] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-muted)]">steps</div>
            <div className="text-[26px] tabular-nums mt-1">{result.stepsCompleted}<span className="text-[14px] text-[var(--color-ink-muted)]"> / {result.stepsCompleted + result.stepsSkipped}</span></div>
          </div>
          <div className="bg-white border border-[var(--color-border-soft)] rounded-[10px] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-muted)]">time</div>
            <div className="text-[26px] tabular-nums mt-1">{minutes}<span className="text-[14px] text-[var(--color-ink-muted)]"> min</span></div>
          </div>
        </section>

        {/* Observation */}
        <section className="mt-5 border-t border-[var(--color-border-soft)] pt-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)]">— one thing</div>
          <p className="mt-2 text-[17px] italic leading-relaxed text-[var(--color-ink)]">{observation}</p>
          {error && <div className="mt-2 font-mono text-[10px] text-[var(--color-accent-warn)]">{error}</div>}
        </section>

        {/* Continue track CTA */}
        {continueTrack && (
          <button
            type="button"
            onClick={() => router.push(`/play/${continueTrack.id}`)}
            className="mt-6 w-full bg-[var(--color-ink)] text-[var(--color-paper)] rounded-[12px] p-4 flex items-center gap-3 text-left"
          >
            <div className="w-9 h-9 rounded-md bg-[var(--color-accent-vocal)] flex items-center justify-center">
              <IconMusic size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[17px] italic truncate">Continue {continueTrack.title}</div>
              <div className="font-mono text-[10px] opacity-70 mt-1">pick up where you left off</div>
            </div>
            <IconArrowRight size={18} />
          </button>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => router.push("/progress")}
            className="flex-1 bg-white border border-[var(--color-border-soft)] rounded-[10px] py-3 font-mono text-[11px]"
          >
            see stats
          </button>
          <button
            type="button"
            onClick={() => router.replace("/warmup")}
            className="flex-1 bg-white border border-[var(--color-border-soft)] rounded-[10px] py-3 font-mono text-[11px]"
          >
            i&apos;m done
          </button>
        </div>
      </div>
    </main>
  );
}

async function fetchObservation(r: SessionResult): Promise<string> {
  const total = 7;
  const facts = [
    "User just finished a Daily 8 vocal warm-up session.",
    `${r.stepsCompleted} of ${total} steps completed naturally.`,
    `${r.stepsSkipped} steps skipped early.`,
    `Total time: ${Math.round(r.durationSec)} seconds.`,
    "Steps in order were: body release, lip trills (SOVT), sirens, vowel scales, messa di voce (swell), staccato, cool-down hum.",
  ].join(" ");
  const body = {
    model: "qwen3.5-2b",
    messages: [
      {
        role: "system",
        content:
          `You write ONE short observation about a vocal warm-up session — a single sentence, ` +
          `friendly and supportive, like a kind vocal coach. No headers, no lists, no emoji, ` +
          `no prefacing. Reply in ${r.language}.`,
      },
      { role: "user", content: facts },
    ],
    max_tokens: 120,
    temperature: 0.7,
    chat_template_kwargs: { enable_thinking: false },
  };
  const resp = await fetch(LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.choices?.[0]?.message?.content || "Voice is ready.").trim();
}
