"use client";

import { usePathname, useRouter } from "next/navigation";
import { IconMusic, IconMicrophone2, IconChartBar, IconUser } from "@tabler/icons-react";
import { hasBottomNav } from "@/lib/nav-visibility";

const TABS = [
  { key: "library", path: "/library", Icon: IconMusic, label: "library" },
  { key: "warmup", path: "/warmup", Icon: IconMicrophone2, label: "warm-up" },
  { key: "progress", path: "/progress", Icon: IconChartBar, label: "progress" },
  { key: "profile", path: "/profile", Icon: IconUser, label: "profile" },
] as const;

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  if (!hasBottomNav(pathname)) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--color-surface)] border-t border-[var(--color-border-soft)] flex justify-around items-stretch"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Primary"
    >
      {TABS.map(({ key, path, Icon, label }) => {
        const active = pathname === path || pathname.startsWith(path + "/");
        return (
          <button
            key={key}
            onClick={() => router.push(path)}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={`flex-1 flex items-center justify-center py-3 transition-colors ${
              active ? "text-[var(--color-ink)]" : "text-[var(--color-ink-faint)]"
            }`}
          >
            <Icon size={20} stroke={1.6} />
          </button>
        );
      })}
    </nav>
  );
}
