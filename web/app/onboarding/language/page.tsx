"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconArrowRight } from "@tabler/icons-react";
import { patchProfile } from "@/lib/api";
import { setUser, isAuthed } from "@/lib/auth";
import { ScreenShell } from "@/components/ui/ScreenShell";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { ButtonText, ErrorText } from "@/components/ui/text";
import { DICTS, setLanguage, type LanguageCode } from "@/lib/strings";

const LANGUAGES: LanguageCode[] = ["English", "Russian", "Spanish", "German", "French", "Chinese"];

export default function LanguageOnboardingPage() {
  const router = useRouter();
  const [language, setLang] = useState<LanguageCode>("English");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reactive translations — re-renders whenever the user picks a language.
  const t = DICTS[language];

  async function commit() {
    setBusy(true);
    setError(null);
    setLanguage(language);
    try {
      if (isAuthed()) {
        const updated = await patchProfile({ language });
        setUser(updated);
        router.replace("/library");
      } else {
        router.replace("/login");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <ScreenShell variant="flow">
      <ScreenHeader
        eyebrow={t.language.eyebrow}
        title={t.language.titleA}
        emphasis={t.language.titleB}
        subtitle={t.language.subtitle}
      />

      <div className="grid grid-cols-2 gap-2">
        {LANGUAGES.map((l) => {
          const active = language === l;
          return (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`relative text-[18px] py-4 rounded-pill border transition-colors flex items-center justify-center ${
                active
                  ? "bg-[var(--color-surface-muted)] text-[var(--color-ink)] border-[var(--color-border-soft)]"
                  : "bg-transparent border-[var(--color-border-soft)] text-[var(--color-ink-muted)]"
              }`}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[var(--color-accent-vocal)]"
                />
              )}
              {l}
            </button>
          );
        })}
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      <button
        type="button"
        onClick={commit}
        disabled={busy}
        className="mt-3 inline-flex items-center justify-center gap-2 bg-[var(--color-ink)] text-[var(--color-paper)] py-5 rounded-pill disabled:opacity-50 w-full"
      >
        <ButtonText className="text-[var(--color-paper)]">
          {busy ? t.common.loading : <>{t.language.continue} <IconArrowRight size={14} className="inline" /></>}
        </ButtonText>
      </button>
    </ScreenShell>
  );
}
