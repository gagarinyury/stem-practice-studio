"use client";

import { useI18n, type Locale } from "@/lib/i18n";

interface Props {
  className?: string;
  compact?: boolean;
}

export function LocaleSwitch({ className = "", compact = false }: Props) {
  const { locale, setLocale } = useI18n();
  const opts: Locale[] = ["en", "ru"];

  if (compact) {
    const next = locale === "en" ? "ru" : "en";
    return (
      <button
        type="button"
        onClick={() => setLocale(next)}
        className={`p-1.5 rounded-md text-[var(--color-ink-muted)] hover:text-ink hover:bg-[var(--color-surface-muted)] font-mono text-[11px] tracking-[0.08em] transition-colors ${className}`}
        title={`Switch to ${next.toUpperCase()}`}
        aria-label={`Switch language to ${next.toUpperCase()}`}
      >
        {locale.toUpperCase()}
      </button>
    );
  }

  return (
    <div
      className={`inline-flex items-center rounded-md border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-0.5 font-mono text-[11px] tracking-[0.08em] ${className}`}
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
