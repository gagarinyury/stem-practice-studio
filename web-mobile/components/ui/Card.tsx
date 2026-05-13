import { ReactNode } from "react";

type Variant = "surface" | "muted";
type Radius = "md" | "lg";

export function Card({
  children,
  variant = "surface",
  radius = "md",
  bordered = true,
  className = "",
}: {
  children: ReactNode;
  variant?: Variant;
  radius?: Radius;
  bordered?: boolean;
  className?: string;
}) {
  const bg = variant === "muted" ? "bg-surface-muted" : "bg-surface";
  const r = radius === "lg" ? "rounded-[18px]" : "rounded-[12px]";
  const border = bordered ? "border-[0.5px] border-border-soft" : "";
  return <div className={`${bg} ${r} ${border} ${className}`}>{children}</div>;
}
