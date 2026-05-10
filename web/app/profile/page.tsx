"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconLogout, IconRotate } from "@tabler/icons-react";
import { getProfile, patchProfile } from "@/lib/api";
import { logout, setUser, type AuthUser } from "@/lib/auth";

const LANGUAGES = ["English", "Russian", "Spanish", "German", "French", "Chinese"];

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getProfile()
      .then((u) => setUserState(u))
      .catch(() => {
        logout();
        router.replace("/login");
      });
  }, [router]);

  async function changeLang(lang: string) {
    if (!user) return;
    setBusy(true);
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
    return <main className="flex-1 flex items-center justify-center font-mono text-[11px] text-[var(--color-ink-muted)]">…</main>;
  }

  return (
    <main className="flex-1 flex flex-col items-center px-4 pt-10 pb-32">
      <div className="w-full max-w-sm">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-vocal)]">— profile —</div>
        <h1 className="mt-2 text-[34px] leading-none italic">You.</h1>
        <p className="mt-3 font-mono text-[11px] text-[var(--color-ink-muted)] break-all">{user.email}</p>

        {/* Voice range card */}
        <section className="mt-7 bg-white border border-[var(--color-border-soft)] rounded-[18px] p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)]">— voice range</div>
          {user.voice_low ? (
            <>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="text-[28px]">{user.voice_low}</span>
                <span className="text-[var(--color-ink-muted)]">—</span>
                <span className="text-[28px]">{user.voice_high}</span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-[var(--color-ink-muted)] italic">{user.voice_type || "voice"}</div>
            </>
          ) : (
            <div className="mt-2 font-mono text-[12px] text-[var(--color-ink-muted)] italic">not set yet</div>
          )}
          <button
            type="button"
            onClick={() => router.push("/warmup/onboarding")}
            className="mt-4 inline-flex items-center gap-2 font-mono text-[11px] text-[var(--color-ink)] border-b border-[var(--color-ink-faint)] pb-[2px] hover:border-[var(--color-ink)]"
          >
            <IconRotate size={14} stroke={1.6} />
            {user.voice_low ? "redo range test" : "set up your range — 60s"}
          </button>
        </section>

        {/* Language */}
        <section className="mt-5 bg-white border border-[var(--color-border-soft)] rounded-[18px] p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)]">— ai response language</div>
          <select
            value={user.language}
            disabled={busy}
            onChange={(e) => changeLang(e.target.value)}
            className="mt-2 w-full bg-[var(--color-surface-muted)] rounded-md font-mono text-[13px] px-3 py-2"
          >
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <div className="mt-2 font-mono text-[10px] text-[var(--color-ink-muted)] leading-relaxed">
            UI stays in English. End-of-session observations come back in this language.
          </div>
        </section>

        {/* Streak */}
        <section className="mt-5 bg-white border border-[var(--color-border-soft)] rounded-[18px] p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)]">— streak</div>
          <div className="mt-2 text-[28px] tabular-nums">{user.streak_count} <span className="text-[14px] text-[var(--color-ink-muted)]">days</span></div>
        </section>

        <button
          type="button"
          onClick={onLogout}
          className="mt-7 inline-flex items-center gap-2 font-mono text-[11px] text-[var(--color-accent-warn)]"
        >
          <IconLogout size={14} stroke={1.6} />
          log out
        </button>
      </div>
    </main>
  );
}
