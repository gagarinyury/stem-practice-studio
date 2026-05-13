"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IconArrowRight, IconMusic } from "@tabler/icons-react";
import { listTracks, postWarmupSession, type TrackSummary } from "@/lib/api";
import { getUser } from "@/lib/auth";
import { RangeStrip } from "@/components/warmup/RangeStrip";
import { ScreenShell } from "@/components/ui/ScreenShell";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { BackLink } from "@/components/ui/BackLink";
import { Eyebrow, MonoSmall, ErrorText } from "@/components/ui/text";
import { t } from "@/lib/strings";

const LLM_URL = "/llm/v1/chat/completions";

interface SessionResult {
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  stepsCompleted: number;
  stepsSkipped: number;
  language: string;
}

const PREVIEW_RESULT: SessionResult = {
  startedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
  finishedAt: new Date().toISOString(),
  durationSec: 8 * 60,
  stepsCompleted: 7,
  stepsSkipped: 0,
  language: "English",
};

export default function DonePage() {
  const router = useRouter();
  const search = useSearchParams();
  const preview = search?.get("preview") === "1";
  const [result, setResult] = useState<SessionResult | null>(null);
  const [observation, setObservation] = useState<string>(t.warmupDone.thinking);
  const [continueTrack, setContinueTrack] = useState<TrackSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preview) {
      setResult(PREVIEW_RESULT);
      setObservation(t.warmupDone.previewObservation);
      return;
    }
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

    void persistAndObserve(parsed);
    void loadLastTrack();
  }, [router, preview]);

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
      setError(t.warmupDone.saveFail);
    }
    try {
      const text = await fetchObservation(r);
      setObservation(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setObservation(`${t.warmupDone.llmFail} — ${msg}`);
    }
  }

  async function loadLastTrack() {
    try {
      const tracks = await listTracks();
      const done = tracks.filter((tr) => tr.status === "done");
      if (done.length) setContinueTrack(done[done.length - 1]);
    } catch {
      // not critical
    }
  }

  if (!result) {
    return (
      <ScreenShell variant="flow">
        <MonoSmall>{t.common.loading}</MonoSmall>
      </ScreenShell>
    );
  }

  const user = getUser();
  const minutes = Math.round(result.durationSec / 60);
  return (
    <ScreenShell variant="flow">
      <div className="relative">
        <ScreenHeader
          eyebrow={`${t.warmupDone.eyebrowDone} · ${minutes} ${t.warmupDone.minSuffix}`}
          title={t.warmupDone.titleA}
          emphasis={t.warmupDone.titleB}
          subtitle={user ? `${t.warmupDone.streakDay} ${user.streak_count + (user.last_session_at ? 0 : 1)}` : undefined}
        />
        <BackLink href="/warmup" />
      </div>

      {user?.voice_low && user?.voice_high && (
        <section className="bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-[12px] p-4">
          <Eyebrow withDashes>{t.warmupDone.yourRange}</Eyebrow>
          <RangeStrip scaleLow="A2" scaleHigh="A4" low={user.voice_low} high={user.voice_high} />
        </section>
      )}

      <section className="grid grid-cols-2 gap-2">
        <div className="bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-[10px] p-3">
          <Eyebrow>{t.warmupDone.steps}</Eyebrow>
          <div className="text-[26px] tabular-nums mt-1">
            {result.stepsCompleted}
            <span className="text-[14px] text-[var(--color-ink-muted)]"> / {result.stepsCompleted + result.stepsSkipped}</span>
          </div>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-[10px] p-3">
          <Eyebrow>{t.warmupDone.time}</Eyebrow>
          <div className="text-[26px] tabular-nums mt-1">
            {minutes}
            <span className="text-[14px] text-[var(--color-ink-muted)]"> {t.warmupDone.minSuffix}</span>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--color-border-soft)] pt-4">
        <Eyebrow withDashes>{t.warmupDone.oneThing}</Eyebrow>
        <p className="mt-2 text-[17px] italic leading-relaxed text-[var(--color-ink)]">{observation}</p>
        {error && <ErrorText className="mt-2 text-[10px]">{error}</ErrorText>}
      </section>

      {continueTrack && (
        <button
          type="button"
          onClick={() => router.push(`/play/${continueTrack.id}`)}
          className="w-full bg-[var(--color-ink)] text-[var(--color-paper)] rounded-[12px] p-4 flex items-center gap-3 text-left"
        >
          <div className="w-9 h-9 rounded-md bg-[var(--color-accent-vocal)] flex items-center justify-center">
            <IconMusic size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[17px] italic truncate">{t.warmupDone.continuePrefix} {continueTrack.title}</div>
            <div className="font-mono text-[10px] opacity-70 mt-1">{t.warmupDone.continueHint}</div>
          </div>
          <IconArrowRight size={18} />
        </button>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => router.push("/progress")}
          className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-[10px] py-3 font-mono text-[11px]"
        >
          {t.warmupDone.seeStats}
        </button>
        <button
          type="button"
          onClick={() => router.replace("/library")}
          className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-[10px] py-3 font-mono text-[11px]"
        >
          {t.warmupDone.iAmDone}
        </button>
      </div>
    </ScreenShell>
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
