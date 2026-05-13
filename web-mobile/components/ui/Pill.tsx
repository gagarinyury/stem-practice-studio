import { ReactNode } from "react";

type Tone = "default" | "muted" | "accent";

export function Pill({
  children,
  tone = "default",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const styles =
    tone === "muted"
      ? "bg-surface-muted text-ink"
      : tone === "accent"
      ? "bg-accent-vocal text-paper"
      : "bg-surface text-ink border-[0.5px] border-border-soft";
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 font-mono text-[11px] ${styles} ${className}`}>
      {children}
    </span>
  );
}
