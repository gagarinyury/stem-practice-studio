"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStreak, listWarmupSessions, type WarmupSession } from "@/lib/api";
import { logout } from "@/lib/auth";

export default function ProgressPage() {
  const router = useRouter();
  const [streak, setStreak] = useState<number | null>(null);
  const [sessions, setSessions] = useState<WarmupSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getStreak(), listWarmupSessions(30)])
      .then(([s, list]) => {
        setStreak(s.streak_count);
        setSessions(list);
        setLoading(false);
      })
      .catch(() => {
        logout();
        router.replace("/login");
      });
  }, [router]);

  return (
    <main className="flex-1 flex flex-col items-center px-4 pt-7 pb-32">
      <div className="w-full max-w-sm">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">Progress</div>
        <h1 className="mt-1 text-[36px] leading-none">Your <em className="text-[var(--color-ink-muted)]">trail.</em></h1>

        {/* Streak */}
        <section className="mt-6 bg-white border border-[var(--color-border-soft)] rounded-[18px] p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)]">— streak</div>
          {loading ? (
            <div className="mt-2 font-mono text-[11px] text-[var(--color-ink-muted)]">…</div>
          ) : (
            <div className="mt-2 text-[44px] tabular-nums leading-none">
              {streak ?? 0}
              <span className="ml-2 text-[14px] text-[var(--color-ink-muted)]">days</span>
            </div>
          )}
        </section>

        {/* Recent sessions */}
        <section className="mt-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)] mb-2">— recent sessions</div>
          {loading ? (
            <div className="font-mono text-[11px] text-[var(--color-ink-muted)]">…</div>
          ) : sessions.length === 0 ? (
            <div className="font-mono text-[11px] text-[var(--color-ink-muted)] italic">no sessions yet — open warm-up to start</div>
          ) : (
            <ul className="divide-y divide-[var(--color-border-soft)]">
              {sessions.map((s) => (
                <li key={s.id} className="py-3 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-[14px]">{new Date(s.finished_at).toLocaleDateString()} <span className="text-[var(--color-ink-muted)] font-mono text-[10px] ml-2">{new Date(s.finished_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
                    <div className="font-mono text-[10px] text-[var(--color-ink-muted)] mt-1">
                      {s.steps_completed}/{s.steps_completed + s.steps_skipped} steps · {Math.round(s.duration_sec / 60)} min
                      {s.peak_note ? ` · peak ${s.peak_note}` : ""}
                      {s.accuracy_pct != null ? ` · ${Math.round(s.accuracy_pct)}%` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
