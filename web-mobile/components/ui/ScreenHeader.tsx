import type { ReactNode } from "react";
import { tokens } from "@/lib/design/tokens";

const ty = tokens.typography;

/**
 * Canonical screen header. For a back/exit affordance, wrap this header in
 * a `<div className="relative">` and place a `<BackLink href|onClick>` next
 * to it — that's the unified pattern across the app.
 */
export function ScreenHeader({
  eyebrow,
  title,
  emphasis,
  subtitle,
  align = "left",
}: {
  eyebrow?: string;
  title: ReactNode;
  emphasis?: ReactNode;
  subtitle?: ReactNode;
  align?: "left" | "center";
}) {
  const centered = align === "center";
  return (
    <header className={`flex flex-col gap-3 ${centered ? "items-center text-center" : ""}`}>
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
