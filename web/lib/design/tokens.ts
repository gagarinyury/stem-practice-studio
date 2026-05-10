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
} as const;

export type ColorToken = keyof typeof tokens.color;
export type RadiusToken = keyof typeof tokens.radius;
