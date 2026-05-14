"use client";

import { useI18n, type Locale } from "@/lib/i18n";

interface Props {
  className?: string;
}

export function LocaleSwitch({ className = "" }: Props) {
  const { locale, setLocale } = useI18n();
  const opts: Locale[] = ["en", "ru"];
  return (
    <div
      className={`inline-flex items-center rounded-md border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-0.5 font-mono text-[10px] tracking-[0.08em] ${className}`}
    >
      {opts.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          className={`rounded px-2 py-1 transition-colors ${
            locale === l
              ? "bg-[var(--color-surface-muted)] text-ink"
              : "text-[var(--color-ink-muted)] hover:text-ink"
          }`}
          aria-pressed={locale === l}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
