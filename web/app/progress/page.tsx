"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStreak, listWarmupSessions, type WarmupSession } from "@/lib/api";
import { logout } from "@/lib/auth";
import { DEV } from "@/lib/dev-user";
import { ScreenShell } from "@/components/ui/ScreenShell";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Eyebrow, MonoSmall } from "@/components/ui/text";
import { t } from "@/lib/strings";

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
        if (DEV) {
          setStreak(3);
          setSessions([]);
          setLoading(false);
          return;
        }
        logout();
        router.replace("/login");
      });
  }, [router]);

  return (
    <ScreenShell variant="flow">
      <ScreenHeader
        eyebrow={t.progress.eyebrow}
        title={t.progress.titleA}
        emphasis={t.progress.titleB}
      />

      <section className="bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-[18px] p-5">
        <Eyebrow withDashes>{t.progress.streak}</Eyebrow>
        {loading ? (
          <MonoSmall className="mt-2 block">…</MonoSmall>
        ) : (
          <div className="mt-2 text-[44px] tabular-nums leading-none">
            {streak ?? 0}
            <span className="ml-2 text-[14px] text-[var(--color-ink-muted)]">{t.progress.days}</span>
          </div>
        )}
      </section>

      <section className="bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-[18px] p-5">
        <Eyebrow withDashes>{t.progress.recentSessions}</Eyebrow>
        {loading ? (
          <MonoSmall className="mt-2 block">…</MonoSmall>
        ) : sessions.length === 0 ? (
          <MonoSmall className="mt-2 block italic">{t.progress.noSessions}</MonoSmall>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--color-border-soft)]">
            {sessions.map((s) => (
              <li key={s.id} className="py-3">
                <div className="text-[14px]">
                  {new Date(s.finished_at).toLocaleDateString()}
                  <MonoSmall className="ml-2">
                    {new Date(s.finished_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </MonoSmall>
                </div>
                <MonoSmall className="mt-1 block">
                  {s.steps_completed}/{s.steps_completed + s.steps_skipped} {t.progress.stepsSuffix} · {Math.round(s.duration_sec / 60)} {t.progress.minSuffix}
                  {s.peak_note ? ` · ${t.progress.peakPrefix} ${s.peak_note}` : ""}
                  {s.accuracy_pct != null ? ` · ${Math.round(s.accuracy_pct)}%` : ""}
                </MonoSmall>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ScreenShell>
  );
}
