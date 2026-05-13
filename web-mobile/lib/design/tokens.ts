export const tokens = {
  color: {
    paper: "#FAF7F2",
    surface: "#FFFFFF",
    surfaceMuted: "#F1EFE8",
    ink: "#2C2C2A",
    inkMuted: "#888780",
    inkFaint: "#B4B2A9",
    border: "rgba(0,0,0,0.08)",
    accentVocal: "#534AB7",
    accentDrill: "#C66857",
    accentPlan: "#BA7517",
    accentSuccess: "#1D9E75",
    accentWarn: "#993C1D",
  },
  radius: {
    sm: "8px",
    md: "12px",
    lg: "18px",
    pill: "999px",
  },
  font: {
    serif: "var(--font-cormorant), Georgia, serif",
    mono: "var(--font-dm-mono), ui-monospace, monospace",
  },
  typography: {
    h1: "font-serif italic text-[36px] leading-[1.05] tracking-tight text-[var(--color-ink)]",
    h2: "font-serif italic text-[26px] leading-[1.1] tracking-tight text-[var(--color-ink)]",
    h3: "font-serif text-[19px] leading-[1.15] text-[var(--color-ink)]",
    serifBody: "font-serif text-[18px] leading-relaxed text-[var(--color-ink)]",
    subtitle: "font-mono text-[14px] leading-relaxed text-[var(--color-ink-muted)]",
    paragraph: "font-mono text-[14px] leading-relaxed text-[var(--color-ink)]",
    monoBase: "font-mono text-[13px] text-[var(--color-ink)]",
    monoSmall: "font-mono text-[11px] text-[var(--color-ink-muted)]",
    eyebrow: "font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)]",
    label: "font-mono text-[12px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)]",
    buttonText: "font-mono text-[14px] uppercase tracking-[0.15em]",
    inputText: "font-mono text-[18px] text-[var(--color-ink)]",
    error: "font-mono text-[13px] text-[var(--color-accent-warn)]",
  },
} as const;

export type ColorToken = keyof typeof tokens.color;
export type RadiusToken = keyof typeof tokens.radius;
