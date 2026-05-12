import Link from "next/link";
import { IconChevronLeft } from "@tabler/icons-react";
import { t } from "@/lib/strings";

/**
 * Canonical "‹ back" affordance for any screen. Render alongside a
 * ScreenHeader inside a `relative` wrapper — it positions to the
 * top-right corner.
 */
export function BackLink({ href, onClick }: { href?: string; onClick?: () => void }) {
  const className = "absolute right-0 top-0 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors";
  const inner = (
    <>
      <IconChevronLeft size={14} stroke={1.6} />
      {t.common.back}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={t.common.back} className={className}>
        {inner}
      </button>
    );
  }
  return (
    <Link href={href ?? "#"} aria-label={t.common.back} className={className}>
      {inner}
    </Link>
  );
}
