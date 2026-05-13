"use client";

import { useEffect, useRef, useState } from "react";
import { IconArrowLeft, IconArrowRight, IconExternalLink } from "@tabler/icons-react";
import { listTracks } from "@/lib/api";

interface ScreenEntry {
  label: string;
  hint: string;
  path: string | ((trackId: string | null) => string);
  needsTrack?: boolean;
}

const SCREENS: ScreenEntry[] = [
  { label: "Login", hint: "register / sign in", path: "/login" },
  { label: "Onboarding · language", hint: "fresh user picks language", path: "/onboarding/language" },
  { label: "Library", hint: "songs list + inline import", path: "/library" },
  { label: "Processing", hint: "stage progress bars", path: (id) => id ? `/processing/${id}` : "/processing/demo", needsTrack: true },
  { label: "Play", hint: "stem player + timeline", path: (id) => id ? `/play/${id}` : "/play/demo", needsTrack: true },
  { label: "Karaoke", hint: "lyric scroll + spectrum", path: (id) => id ? `/karaoke/${id}` : "/karaoke/demo", needsTrack: true },
  { label: "Select", hint: "track resolution / metadata", path: (id) => id ? `/select/${id}` : "/select/demo", needsTrack: true },
  { label: "Drill", hint: "pitch drill loop", path: (id) => id ? `/drill/${id}` : "/drill/demo", needsTrack: true },
  { label: "Warmup · hub", hint: "Daily 8 entry", path: "/warmup" },
  { label: "Warmup · onboarding", hint: "low/high range test", path: "/warmup/onboarding" },
  { label: "Warmup · session", hint: "live Daily 8 run", path: "/warmup/session/daily8" },
  { label: "Warmup · done", hint: "completion + LLM observation", path: "/warmup/session/daily8/done" },
  { label: "Profile", hint: "language · range · logout", path: "/profile" },
  { label: "Progress", hint: "streak + sessions list", path: "/progress" },
];

export default function TourPage() {
  const [idx, setIdx] = useState(0);
  const [trackId, setTrackId] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    listTracks()
      .then((tracks) => {
        const done = tracks.find((t) => t.status === "done");
        if (done) setTrackId(done.id);
        else if (tracks.length) setTrackId(tracks[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight") setIdx((i) => Math.min(SCREENS.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = SCREENS[idx];
  const url = typeof current.path === "function" ? current.path(trackId) : current.path;
  const hasReal = current.needsTrack ? !!trackId : true;

  return (
    <main className="min-h-screen bg-[var(--color-surface-muted)] flex flex-col">
      {/* Top header */}
      <header className="px-6 py-4 border-b border-[var(--color-border-soft)] bg-paper flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-ink-muted)]">
            screen tour · {idx + 1} / {SCREENS.length}
          </div>
          <h1 className="text-[20px] italic leading-tight mt-0.5">
            {current.label}
            <span className="not-italic text-[var(--color-ink-muted)] text-[13px] font-mono ml-3">— {current.hint}</span>
          </h1>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] text-[var(--color-accent-vocal)] inline-flex items-center gap-1.5 hover:underline"
        >
          open <IconExternalLink size={13} />
        </a>
      </header>

      {/* Two-column body: screen index | iframe */}
      <div className="flex-1 flex min-h-0">
        <aside className="w-[220px] border-r border-[var(--color-border-soft)] bg-paper overflow-y-auto py-2">
          {SCREENS.map((s, i) => (
            <button
              key={s.path.toString() + i}
              type="button"
              onClick={() => setIdx(i)}
              className={`w-full text-left px-4 py-2 font-mono text-[11px] border-l-2 transition-colors ${
                i === idx
                  ? "bg-[var(--color-surface-muted)] text-ink border-[var(--color-accent-vocal)]"
                  : "text-[var(--color-ink-muted)] border-transparent hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              <div className="text-[10px] text-[var(--color-ink-faint)]">{String(i + 1).padStart(2, "0")}</div>
              <div>{s.label}</div>
            </button>
          ))}
        </aside>

        <div className="flex-1 flex items-stretch justify-center bg-[#E8E5DC] overflow-hidden">
          {hasReal ? (
            <iframe
              ref={iframeRef}
              key={url}
              src={url}
              className="w-full h-full bg-paper"
              title={current.label}
            />
          ) : (
            <div className="flex items-center justify-center w-full font-mono text-[12px] text-[var(--color-ink-muted)]">
              need a processed track first — go to /library and add one
            </div>
          )}
        </div>
      </div>

      {/* Bottom nav */}
      <footer className="px-6 py-3 border-t border-[var(--color-border-soft)] bg-paper flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink disabled:opacity-30"
        >
          <IconArrowLeft size={14} /> prev
        </button>
        <div className="font-mono text-[10px] text-[var(--color-ink-muted)]">← → keyboard arrows</div>
        <button
          type="button"
          onClick={() => setIdx((i) => Math.min(SCREENS.length - 1, i + 1))}
          disabled={idx === SCREENS.length - 1}
          className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink disabled:opacity-30"
        >
          next <IconArrowRight size={14} />
        </button>
      </footer>
    </main>
  );
}
