"use client";

import { usePathname, useRouter } from "next/navigation";
import { IconMusic, IconMicrophone2, IconChartBar, IconUser } from "@tabler/icons-react";

const TABS = [
  { key: "library", path: "/library", Icon: IconMusic, label: "library" },
  { key: "warmup", path: "/warmup", Icon: IconMicrophone2, label: "warm-up" },
  { key: "progress", path: "/progress", Icon: IconChartBar, label: "progress" },
  { key: "profile", path: "/profile", Icon: IconUser, label: "profile" },
] as const;

const HIDDEN_PATHS = [
  "/login",
  "/warmup/onboarding",
  "/warmup/session",
  "/processing",
  "/play",
  "/karaoke",
  "/select",
  "/drill",
];

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const hidden = HIDDEN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (hidden) return null;

  return (
    <nav
      className="fixed bottom-3 left-1/2 -translate-x-1/2 w-[min(360px,calc(100%-24px))] bg-white border border-[var(--color-border-soft)] rounded-pill p-2 flex justify-around z-40"
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
            className={`flex flex-col items-center gap-[2px] px-3 py-[6px] rounded-pill transition-colors ${
              active
                ? "bg-[var(--color-surface-muted)] text-[var(--color-ink)]"
                : "text-[var(--color-ink-muted)]"
            }`}
          >
            <Icon size={18} stroke={1.6} />
          </button>
        );
      })}
    </nav>
  );
}
