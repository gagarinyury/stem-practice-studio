import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { tokens } from "@/lib/design/tokens";

const ty = tokens.typography;

/**
 * Canonical screen header. Three slots, all optional except `title`:
 *
 *  - back: route for a "← back" affordance (top-left). null = no button.
 *  - eyebrow: small mono-uppercase tag ("— now studying", "— first —")
 *  - title + emphasis: serif h1 ("Sign" + "in.")
 *
 * h1 is fixed at 36px serif italic. Eyebrow is 10px mono.
 */
export function ScreenHeader({
  back,
  eyebrow,
  title,
  emphasis,
  subtitle,
}: {
  back?: string;
  eyebrow?: string;
  title: ReactNode;
  emphasis?: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      {back && (
        <Link
          href={back}
          className={`inline-flex items-center gap-1.5 ${ty.eyebrow} hover:text-[var(--color-ink)] w-fit`}
        >
          <IconArrowLeft size={12} stroke={1.6} /> back
        </Link>
      )}
      {eyebrow && (
        <div className={`${ty.eyebrow} text-[var(--color-accent-vocal)]`}>
          — {eyebrow} —
        </div>
      )}
      <h1 className={ty.h1}>
        {title}
        {emphasis && <em className="not-italic text-[var(--color-ink-muted)]"> {emphasis}</em>}
      </h1>
      {subtitle && <p className={ty.subtitle}>{subtitle}</p>}
    </header>
  );
}
