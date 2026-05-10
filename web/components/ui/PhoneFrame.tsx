import { IconBattery3, IconWifi } from "@tabler/icons-react";
import type { ReactNode } from "react";

/** 360px-wide paper-style phone frame. Header has fake clock & status icons. */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="bg-[var(--color-surface-muted)] p-6 rounded-[var(--radius-lg)] flex justify-center">
      <div className="w-[360px] bg-paper rounded-[28px] border border-[var(--color-border-soft)] overflow-hidden font-serif">
        <div className="px-5 pt-3.5 flex justify-between items-center font-mono text-[11px] text-ink">
          <span>9:41</span>
          <span className="flex gap-1 items-center">
            <IconWifi size={13} />
            <IconBattery3 size={13} />
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
