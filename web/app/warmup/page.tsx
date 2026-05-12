"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlayerPlayFilled, IconArrowRight } from "@tabler/icons-react";
import { getProfile } from "@/lib/api";
import { logout, type AuthUser } from "@/lib/auth";
import { DEV, DEV_USER } from "@/lib/dev-user";
import { ScreenShell } from "@/components/ui/ScreenShell";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Eyebrow, MonoSmall, TextH2, TextH3 } from "@/components/ui/text";
import { TipBadge } from "@/components/ui/TipBadge";
import { t } from "@/lib/strings";

// Six accent-vocal shades for the 7-step progress strip. Derived from
// --color-accent-vocal (#534AB7) with decreasing saturation.
const STEP_COLORS = ["#534AB7", "#534AB7", "#7F77DD", "#AFA9EC", "#CECBF6", "#CECBF6", "#EEEDFE"];

export default function WarmupHub() {
  const router = useRouter();
  const [user, setUserState] = useState<AuthUser | null>(null);

  useEffect(() => {
    getProfile()
      .then((u) => setUserState(u))
      .catch(() => {
        if (DEV) {
          setUserState(DEV_USER);
          return;
        }
        logout();
        router.replace("/login");
      });
  }, [router]);

  if (!user) {
    return (
      <ScreenShell variant="flow">
        <MonoSmall>{t.common.loading}</MonoSmall>
      </ScreenShell>
    );
  }

  const hasRange = !!user.voice_low;
  const labels = t.warmup.stepLabels;
  const streakLine = user.streak_count === 0
    ? t.warmup.streakNone
    : `${t.warmup.streakDay} ${user.streak_count} · ${t.warmup.streakSuffix}`;

  return (
    <ScreenShell variant="flow">
      <ScreenHeader
        eyebrow={t.warmup.eyebrow}
        title={t.warmup.titleA}
        emphasis={t.warmup.titleB}
        subtitle={hasRange
          ? `${t.warmup.rangeTuned} ${user.voice_low}—${user.voice_high}`
          : t.warmup.rangeFirst}
      />

      {hasRange && (
        <button
          type="button"
          onClick={() => router.push("/warmup/onboarding")}
          className="self-start -mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] border-b border-[var(--color-ink-faint)] pb-[2px]"
        >
          {t.profile.redoRange} →
        </button>
      )}

      {hasRange ? (
        <button
          type="button"
          onClick={() => router.push("/warmup/session/daily8")}
          aria-label={t.warmup.startDaily}
          className="block w-full text-left bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-[18px] p-5 active:bg-[var(--color-surface-muted)] transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <Eyebrow withDashes className="text-[var(--color-accent-vocal)]">{t.warmup.todaysSession}</Eyebrow>
              <TextH3 className="mt-1 italic">{t.warmup.dailyTitle}</TextH3>
              <MonoSmall className="mt-1 block">{t.warmup.dailyMeta}</MonoSmall>
              <MonoSmall className="block">{streakLine}</MonoSmall>
            </div>
            <span
              aria-hidden
              className="w-14 h-14 shrink-0 rounded-full bg-[var(--color-accent-drill)] text-[var(--color-paper)] flex items-center justify-center"
            >
              <IconPlayerPlayFilled size={24} />
            </span>
          </div>
          <ul className="mt-5 flex flex-col gap-2">
            {labels.map((l, i) => (
              <li key={l} className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="w-1.5 h-4 rounded shrink-0"
                  style={{ background: STEP_COLORS[i] }}
                />
                <MonoSmall className="text-[12px]">{l}</MonoSmall>
              </li>
            ))}
          </ul>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => router.push("/warmup/onboarding")}
          aria-label={t.warmup.startOnboarding}
          className="w-full text-left bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-[18px] p-5 flex items-center gap-4 active:bg-[var(--color-surface-muted)] transition-colors"
        >
          <div className="flex-1">
            <Eyebrow withDashes className="text-[var(--color-accent-vocal)]">{t.warmup.letsBegin}</Eyebrow>
            <TextH2 className="mt-1">{t.warmup.setupRange}</TextH2>
            <MonoSmall className="mt-1 block">{t.warmup.setupHint}</MonoSmall>
          </div>
          <span
            aria-hidden
            className="w-12 h-12 shrink-0 rounded-full bg-[var(--color-accent-drill)] text-[var(--color-paper)] flex items-center justify-center"
          >
            <IconArrowRight size={20} />
          </span>
        </button>
      )}

      <TipBadge tone="info">{t.warmup.scienceNote}</TipBadge>
    </ScreenShell>
  );
}
