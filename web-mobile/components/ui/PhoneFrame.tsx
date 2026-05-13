import type { ReactNode } from "react";

/** 360px-wide paper-style phone frame. */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="bg-[var(--color-surface-muted)] p-6 rounded-[var(--radius-lg)] flex justify-center">
      <div className="w-[360px] bg-paper rounded-[28px] border border-[var(--color-border-soft)] overflow-hidden font-serif">
        {children}
      </div>
    </div>
  );
}
