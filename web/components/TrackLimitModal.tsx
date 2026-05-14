"use client";

import { IconBrandWhatsapp, IconX } from "@tabler/icons-react";
import type { User } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Props {
  user: User;
  limit: number;
  onClose: () => void;
}

const WHATSAPP_PHONE = "33755209758";

export function TrackLimitModal({ user, limit, onClose }: Props) {
  const { t } = useI18n();
  const text = encodeURIComponent(t("feedback.template", { email: user.email }));
  const href = `https://wa.me/${WHATSAPP_PHONE}?text=${text}`;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/35 px-4">
      <section className="w-full max-w-[500px] rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
              {t("trackLimit.badge")}
            </div>
            <h2 className="mt-2 text-[24px] font-serif italic leading-tight text-[var(--color-ink)]">
              {t("trackLimit.processed", { limit })}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-md border border-[var(--color-border-soft)] text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
            aria-label={t("trackLimit.close")}
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-[14px] leading-6 text-[var(--color-ink-muted)]">
          <p>{t("trackLimit.body1")}</p>
          <p>{t("trackLimit.body2")}</p>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-border-soft)] px-4 py-2 text-[13px] text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            {t("trackLimit.close")}
          </button>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--color-ink)] px-4 py-2 text-[13px] text-[var(--color-paper)] transition-opacity hover:opacity-90"
          >
            <IconBrandWhatsapp size={16} />
            {t("trackLimit.writeWhatsapp")}
          </a>
        </div>
      </section>
    </div>
  );
}
