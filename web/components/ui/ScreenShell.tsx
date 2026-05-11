import type { ReactNode } from "react";

/**
 * Single canonical wrapper for every full-screen route in the app.
 * Variants pick the visual treatment, but spacing tokens and centering
 * are normalized so all screens share the same rhythm.
 *
 * - `flow`: full-width centered column, capped at 380px. Used for sign-in,
 *   onboarding steps, profile — anything that's a focused modal-like flow.
 * - `phone`: 360px paper-card frame (the existing PhoneFrame look) for
 *   library-style "embedded device" screens.
 */
export function ScreenShell({
  variant = "flow",
  compact = false,
  children,
}: {
  variant?: "flow" | "phone";
  compact?: boolean;
  children: ReactNode;
}) {
  if (variant === "phone") {
    return (
      <div className="min-h-screen bg-[var(--color-surface-muted)] flex items-start justify-center px-4 py-8">
        <div className="w-[360px] bg-paper rounded-[28px] border border-[var(--color-border-soft)] overflow-hidden font-serif">
          {children}
        </div>
      </div>
    );
  }
  return (
    <main
      className="h-[100dvh] flex flex-col items-center px-7 overflow-hidden"
      style={{
        paddingTop: "max(56px, env(safe-area-inset-top, 0px))",
        paddingBottom: "max(24px, var(--bottom-reserve))",
      }}
    >
      <div className={`w-full max-w-[380px] flex-1 min-h-0 flex flex-col ${compact ? "gap-4" : "gap-6"}`}>
        {children}
      </div>
    </main>
  );
}
