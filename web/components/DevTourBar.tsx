"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IconArrowLeft, IconArrowRight, IconList, IconX } from "@tabler/icons-react";

/**
 * Dev-only floating navigation: lets you flip through every screen in the app
 * sequentially without dealing with auth / state / routes. Only renders in
 * development mode. Tap label to open the screen list, ← → to step.
 */
const SCREENS: Array<{ label: string; path: string | ((id: string | null) => string); needsTrack?: boolean }> = [
  { label: "login",              path: "/login" },
  { label: "onboarding lang",    path: "/onboarding/language" },
  { label: "library",            path: "/library" },
  { label: "processing",         path: (id) => id ? `/processing/${id}?preview=1` : "/processing/demo?preview=1", needsTrack: true },
  { label: "play",               path: (id) => id ? `/play/${id}` : "/play/demo", needsTrack: true },
  { label: "karaoke",            path: (id) => id ? `/karaoke/${id}` : "/karaoke/demo", needsTrack: true },
  { label: "select",             path: (id) => id ? `/select/${id}` : "/select/demo", needsTrack: true },
  { label: "drill",              path: (id) => id ? `/drill/${id}` : "/drill/demo", needsTrack: true },
  { label: "warmup hub",         path: "/warmup" },
  { label: "warmup onboarding",  path: "/warmup/onboarding" },
  { label: "warmup session",     path: "/warmup/session/daily8" },
  { label: "warmup done",        path: "/warmup/session/daily8/done" },
  { label: "profile",            path: "/profile" },
  { label: "progress",           path: "/progress" },
];

export function DevTourBar() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [trackId, setTrackId] = useState<string | null>(null);

  useEffect(() => {
    // Best-effort: grab any done track id for screens that need one.
    try {
      const cached = window.localStorage.getItem("devtour.trackId");
      if (cached) setTrackId(cached);
    } catch {}
    fetch("/api/_passthrough_tracks").catch(() => {});
    // Fetch directly from API_BASE — same code path as listTracks but lightweight here
    import("@/lib/api").then(({ listTracks }) => {
      listTracks()
        .then((tracks) => {
          const done = tracks.find((t) => t.status === "done") || tracks[0];
          if (done) {
            setTrackId(done.id);
            try { window.localStorage.setItem("devtour.trackId", done.id); } catch {}
          }
        })
        .catch(() => {});
    });
  }, []);

  function resolve(s: typeof SCREENS[number]): string {
    return typeof s.path === "function" ? s.path(trackId) : s.path;
  }

  // Match by URL prefix so /play/<id> still highlights "play" entry.
  const currentIdx = SCREENS.findIndex((s) => {
    const url = resolve(s).split("?")[0];
    return pathname === url || pathname.startsWith(url + "/");
  });

  function goto(i: number) {
    const next = SCREENS[Math.max(0, Math.min(SCREENS.length - 1, i))];
    router.push(resolve(next));
    setOpen(false);
  }

  const prevIdx = currentIdx <= 0 ? null : currentIdx - 1;
  const nextIdx = currentIdx < 0 || currentIdx >= SCREENS.length - 1 ? null : currentIdx + 1;
  const label = currentIdx >= 0 ? SCREENS[currentIdx].label : "—";

  return (
    <>
      {/* Floating bar */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] bg-[var(--color-ink)] text-[var(--color-paper)] rounded-pill shadow-lg flex items-center gap-1 px-1 py-1 text-[12px] font-mono pointer-events-auto">
        <button
          type="button"
          onClick={() => prevIdx !== null && goto(prevIdx)}
          disabled={prevIdx === null}
          className="px-3 py-2 rounded-pill disabled:opacity-30 active:bg-white/10"
          aria-label="previous screen"
        >
          <IconArrowLeft size={14} />
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-[64px] px-2 py-2 rounded-pill flex items-center justify-center gap-1.5 active:bg-white/10 tabular-nums"
          aria-label={`screen ${label}`}
        >
          <IconList size={13} />
          <span className="opacity-90">{currentIdx >= 0 ? `${currentIdx + 1}/${SCREENS.length}` : "?"}</span>
        </button>
        <button
          type="button"
          onClick={() => nextIdx !== null && goto(nextIdx)}
          disabled={nextIdx === null}
          className="px-3 py-2 rounded-pill disabled:opacity-30 active:bg-white/10"
          aria-label="next screen"
        >
          <IconArrowRight size={14} />
        </button>
      </div>

      {/* Screen list panel */}
      {open && (
        <div className="fixed inset-0 z-[9998] bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="absolute bottom-20 left-1/2 -translate-x-1/2 w-[280px] max-h-[60vh] overflow-y-auto bg-paper rounded-[18px] border border-[var(--color-border-soft)] py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border-soft)]">
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)]">
                screen tour · {SCREENS.length}
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="close">
                <IconX size={14} />
              </button>
            </div>
            {SCREENS.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goto(i)}
                className={`w-full text-left px-4 py-2.5 font-mono text-[12px] flex items-center justify-between ${
                  i === currentIdx ? "bg-[var(--color-surface-muted)] text-ink" : "text-[var(--color-ink-muted)]"
                }`}
              >
                <span><span className="text-[var(--color-ink-faint)]">{String(i + 1).padStart(2, "0")}</span>  {s.label}</span>
                {i === currentIdx && <span className="text-[var(--color-accent-vocal)]">●</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
