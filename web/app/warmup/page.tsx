"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlayerPlayFilled, IconArrowRight } from "@tabler/icons-react";
import { getProfile } from "@/lib/api";
import { logout, type AuthUser } from "@/lib/auth";

const STEP_LABELS = ["release", "sovt", "siren", "scale", "swell", "stacc", "cool"];
const STEP_COLORS = ["#534AB7", "#534AB7", "#7F77DD", "#AFA9EC", "#CECBF6", "#CECBF6", "#EEEDFE"];

export default function WarmupHub() {
  const router = useRouter();
  const [user, setUserState] = useState<AuthUser | null>(null);

  useEffect(() => {
    getProfile()
      .then((u) => setUserState(u))
      .catch(() => {
        logout();
        router.replace("/login");
      });
  }, [router]);

  if (!user) {
    return <main className="flex-1 flex items-center justify-center font-mono text-[11px] text-[var(--color-ink-muted)]">…</main>;
  }

  const hasRange = !!user.voice_low;

  return (
    <main className="flex-1 flex flex-col items-center px-4 pt-7 pb-32">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">Warm-up</div>
        <h1 className="mt-1 text-[36px] leading-none">
          Wake the <em className="text-[var(--color-ink-muted)]">voice.</em>
        </h1>
        <div className="mt-2 font-mono text-[11px] text-[var(--color-ink-muted)] leading-relaxed">
          {hasRange ? `tuned to your range · ${user.voice_low}—${user.voice_high}` : "first, find your range"}
        </div>

        {/* Daily 8 card OR onboarding CTA */}
        {hasRange ? (
          <section className="mt-6 bg-white border border-[var(--color-border-soft)] rounded-[18px] p-5">
            <div className="flex items-start justify-between">
              <div className="flex-1 pr-3">
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-accent-vocal)]">— today's session</div>
                <div className="mt-1 text-[24px] italic leading-tight">Daily 8</div>
                <div className="mt-1 font-mono text-[11px] text-[var(--color-ink-muted)] leading-relaxed">
                  8 min · before practice<br />day {user.streak_count} of streak
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.push("/warmup/session/daily8")}
                aria-label="start Daily 8"
                className="w-14 h-14 rounded-full bg-[var(--color-ink)] text-[var(--color-paper)] flex items-center justify-center"
              >
                <IconPlayerPlayFilled size={24} />
              </button>
            </div>
            <div className="mt-4 flex gap-1">
              {STEP_COLORS.map((c, i) => (
                <div key={i} className="flex-1 h-1 rounded" style={{ background: c }} title={STEP_LABELS[i]} />
              ))}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[9px] text-[var(--color-ink-muted)] tracking-[0.05em]">
              {STEP_LABELS.map((l) => <span key={l}>{l}</span>)}
            </div>
          </section>
        ) : (
          <section className="mt-6 bg-[var(--color-ink)] text-[var(--color-paper)] rounded-[18px] p-5 flex items-center gap-4">
            <div className="flex-1">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] opacity-70">— let's begin</div>
              <div className="mt-1 text-[20px] italic leading-tight">Set up your range — 60s</div>
              <div className="mt-1 font-mono text-[10px] opacity-70">we tune every exercise to your voice</div>
            </div>
            <button
              type="button"
              onClick={() => router.push("/warmup/onboarding")}
              className="w-12 h-12 rounded-full bg-[var(--color-paper)] text-[var(--color-ink)] flex items-center justify-center"
              aria-label="start onboarding"
            >
              <IconArrowRight size={20} />
            </button>
          </section>
        )}

        {/* Science note */}
        <section className="mt-7 bg-[var(--color-surface-muted)] rounded-[12px] p-4 flex gap-3 items-start">
          <span className="font-mono text-[9px] uppercase tracking-[0.05em] text-[var(--color-accent-vocal)] mt-1">i</span>
          <p className="text-[13px] italic leading-relaxed text-[var(--color-ink)]">
            5–8 minutes is enough. The act of warming up matters more than the perfect method.
          </p>
        </section>
      </div>
    </main>
  );
}
