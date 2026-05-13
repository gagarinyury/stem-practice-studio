import { ReactNode } from "react";

type Size = "base" | "sm";
type Tone = "ink" | "muted" | "faint";

const sizeMap: Record<Size, string> = {
  base: "text-[13px]",
  sm: "text-[11px]",
};

const toneMap: Record<Tone, string> = {
  ink: "text-ink",
  muted: "text-ink-muted",
  faint: "text-ink-faint",
};

export function MonoText({
  children,
  size = "base",
  tone = "ink",
  className = "",
}: {
  children: ReactNode;
  size?: Size;
  tone?: Tone;
  className?: string;
}) {
  return <span className={`font-mono ${sizeMap[size]} ${toneMap[tone]} ${className}`}>{children}</span>;
}
