import type { ReactNode } from "react";

type Tone = "info" | "warm" | "success";

const PALETTE: Record<Tone, { bg: string; mark: string; body: string; glyph: string }> = {
  info: { bg: "var(--color-surface-muted)", mark: "var(--color-accent-vocal)", body: "var(--color-ink)", glyph: "i" },
  warm: { bg: "#FAEEDA", mark: "var(--color-accent-plan)", body: "#633806", glyph: "!" },
  success: { bg: "#E1F5EE", mark: "var(--color-accent-success)", body: "#04342C", glyph: "✓" },
};

export function TipBadge({ tone = "info", align = "start", children }: { tone?: Tone; align?: "start" | "left"; children: ReactNode }) {
  const p = PALETTE[tone];
  return (
    <div
      className={`rounded-[12px] p-4 flex gap-3 items-start ${align === "left" ? "text-left" : ""}`}
      style={{ background: p.bg }}
    >
      <span
        className="font-mono text-[10px] uppercase tracking-[0.05em] mt-1"
        style={{ color: p.mark }}
      >
        {p.glyph}
      </span>
      <p className="font-serif text-[14px] italic leading-relaxed flex-1" style={{ color: p.body }}>
        {children}
      </p>
    </div>
  );
}
