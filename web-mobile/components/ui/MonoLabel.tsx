import { ReactNode } from "react";

type Size = "xs" | "micro";
type Tone = "muted" | "ink" | "plan" | "drill" | "warn";

const dashPrefix = "— ";

const sizeMap: Record<Size, string> = {
  xs: "text-[10px] tracking-[0.15em]",
  micro: "text-[9px] tracking-[0.20em]",
};

const toneMap: Record<Tone, string> = {
  muted: "text-ink-muted",
  ink: "text-ink",
  plan: "text-accent-plan",
  drill: "text-accent-drill",
  warn: "text-accent-warn",
};

export function MonoLabel({
  children,
  size = "xs",
  tone = "muted",
  withDash = true,
  className = "",
}: {
  children: ReactNode;
  size?: Size;
  tone?: Tone;
  withDash?: boolean;
  className?: string;
}) {
  return (
    <span className={`font-mono uppercase ${sizeMap[size]} ${toneMap[tone]} ${className}`}>
      {withDash ? dashPrefix : ""}
      {children}
    </span>
  );
}
