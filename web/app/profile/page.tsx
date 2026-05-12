"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconLogout, IconRotate } from "@tabler/icons-react";
import { getProfile, patchProfile } from "@/lib/api";
import { logout, setUser, type AuthUser } from "@/lib/auth";
import { ScreenShell } from "@/components/ui/ScreenShell";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Eyebrow, MonoSmall, Paragraph, ButtonText } from "@/components/ui/text";
import { t, setLanguage, type LanguageCode } from "@/lib/strings";
import { DEV, DEV_USER } from "@/lib/dev-user";

const LANGUAGES: LanguageCode[] = ["English", "Russian", "Spanish", "German", "French", "Chinese"];

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function changeLang(lang: LanguageCode) {
    if (!user) return;
    setBusy(true);
    setLanguage(lang);
    try {
      const updated = await patchProfile({ language: lang });
      setUserState(updated);
      setUser(updated);
    } finally {
      setBusy(false);
    }
  }

  function onLogout() {
    logout();
    router.replace("/login");
  }

  if (!user) {
    return (
      <ScreenShell variant="flow">
        <MonoSmall>{t.common.loading}</MonoSmall>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell variant="flow">
      <ScreenHeader
        eyebrow={t.profile.eyebrow}
        title={t.profile.titleA}
        emphasis={t.profile.titleB}
        subtitle={user.email}
      />

      <section className="bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-[18px] p-5">
        <Eyebrow withDashes>{t.profile.voiceRange}</Eyebrow>
        {user.voice_low ? (
          <>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-[28px]">{user.voice_low}</span>
              <span className="text-[var(--color-ink-muted)]">—</span>
              <span className="text-[28px]">{user.voice_high}</span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-[var(--color-ink-muted)] italic">{user.voice_type || t.profile.voiceFallback}</div>
          </>
        ) : (
          <div className="mt-2 font-mono text-[12px] text-[var(--color-ink-muted)] italic">{t.profile.notSet}</div>
        )}
        <button
          type="button"
          onClick={() => router.push("/warmup/onboarding")}
          className="mt-4 inline-flex items-center gap-2 font-mono text-[11px] text-[var(--color-ink)] border-b border-[var(--color-ink-faint)] pb-[2px] hover:border-[var(--color-ink)]"
        >
          <IconRotate size={14} stroke={1.6} />
          {user.voice_low ? t.profile.redoRange : t.profile.setupRange}
        </button>
      </section>

      <section className="bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-[18px] p-5">
        <Eyebrow withDashes>{t.profile.aiLanguage}</Eyebrow>
        <select
          value={user.language}
          disabled={busy}
          onChange={(e) => changeLang(e.target.value as LanguageCode)}
          className="mt-2 w-full bg-[var(--color-surface-muted)] rounded-md font-mono text-[13px] px-3 py-2"
        >
          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <Paragraph className="mt-2 text-[10px] leading-relaxed text-[var(--color-ink-muted)]">
          {t.profile.languageHint}
        </Paragraph>
      </section>

      <section className="bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-[18px] p-5">
        <Eyebrow withDashes>{t.profile.streak}</Eyebrow>
        <div className="mt-2 text-[28px] tabular-nums">
          {user.streak_count}{" "}
          <span className="text-[14px] text-[var(--color-ink-muted)]">{t.profile.days}</span>
        </div>
      </section>

      <button
        type="button"
        onClick={onLogout}
        className="inline-flex items-center gap-2 text-[var(--color-accent-warn)] w-fit"
      >
        <IconLogout size={14} stroke={1.6} />
        <ButtonText className="text-[var(--color-accent-warn)] normal-case tracking-normal text-[11px]">
          {t.profile.logout}
        </ButtonText>
      </button>
    </ScreenShell>
  );
}
