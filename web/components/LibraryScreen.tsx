"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconLoader2, IconMicrophone2, IconPlayerPlay, IconPlus } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PhoneFrame } from "./ui/PhoneFrame";
import { getStreak, type TrackSummary } from "@/lib/api";

const PALETTE = [
  { bg: "#EEEDFE", fg: "#3C3489" },
  { bg: "#FAEEDA", fg: "#854F0B" },
  { bg: "#E1F5EE", fg: "#085041" },
  { bg: "#F1EFE8", fg: "#5F5E5A" },
];

function initials(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function fmtMeta(t: TrackSummary): string {
  if (t.status === "processing" || t.status === "queued") return `${t.artist || ""} · processing`.trim();
  if (t.status === "failed") return `${t.artist || ""} · failed`.trim();
  return [t.artist, t.duration ? `${Math.round(t.duration / 60)}:${String(Math.round(t.duration % 60)).padStart(2, "0")}` : null]
    .filter(Boolean)
    .join(" · ");
}

export function LibraryScreen({ tracks }: { tracks: TrackSummary[] }) {
  const router = useRouter();
  const [streak, setStreak] = useState<number | null>(null);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    getStreak()
      .then((s) => {
        setStreak(s.streak_count);
        setHasSession(!!s.last_session_at);
      })
      .catch(() => { /* not authenticated yet — fine */ });
  }, []);

  const inProgress = tracks.filter((t) => t.status === "processing" || t.status === "queued");
  const done = tracks.filter((t) => t.status === "done");

  return (
    <PhoneFrame>
      {streak !== null && (
        <button
          type="button"
          onClick={() => router.push("/warmup")}
          className="mx-6 mt-4 flex items-center gap-3 bg-[var(--color-surface-muted)] rounded-[12px] px-3 py-2 text-left"
        >
          <IconMicrophone2 size={18} className="text-[var(--color-accent-vocal)]" />
          <div className="flex-1 min-w-0">
            {hasSession ? (
              <div className="font-mono text-[11px] text-[var(--color-ink)]">
                warm-up streak · <span className="tabular-nums">{streak}</span> {streak === 1 ? "day" : "days"}
              </div>
            ) : (
              <div className="font-mono text-[11px] text-[var(--color-ink)]">warm up your voice first — 8 min</div>
            )}
          </div>
          <span className="font-mono text-[10px] text-[var(--color-ink-muted)]">›</span>
        </button>
      )}
      <div className="px-6 pt-6 flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)]">
            Library
          </div>
          <div className="text-[36px] leading-none text-ink mt-1">
            Your <em className="text-[#5F5E5A]">songs.</em>
          </div>
        </div>
        <Link href="/" className="text-ink">
          <IconPlus size={22} />
        </Link>
      </div>

      <div className="px-6 pt-4 flex gap-2 overflow-x-auto pb-1">
        <span className="font-mono text-[11px] px-3 py-1.5 rounded-[var(--radius-pill)] bg-ink text-paper whitespace-nowrap">
          all · {tracks.length}
        </span>
        {inProgress.length > 0 && (
          <span className="font-mono text-[11px] px-3 py-1.5 rounded-[var(--radius-pill)] border border-[var(--color-border-soft)] text-[#5F5E5A] whitespace-nowrap">
            in progress · {inProgress.length}
          </span>
        )}
      </div>

      {inProgress.length > 0 && (
        <Section label="— in progress">
          {inProgress.map((t, i) => (
            <Row
              key={t.id}
              t={t}
              palette={PALETTE[i % PALETTE.length]}
              onClick={() => router.push(`/processing/${t.id}`)}
              icon={<IconLoader2 size={16} className="text-[var(--color-accent-vocal)] animate-spin" />}
            />
          ))}
        </Section>
      )}

      {done.length > 0 && (
        <Section label="— ready">
          {done.map((t, i) => (
            <Row
              key={t.id}
              t={t}
              palette={PALETTE[i % PALETTE.length]}
              onClick={() => router.push(`/play/${t.id}`)}
              icon={<IconPlayerPlay size={18} className="text-ink" />}
            />
          ))}
        </Section>
      )}

      {tracks.length === 0 && (
        <div className="px-6 py-12 text-center">
          <div className="font-mono text-[12px] text-[var(--color-ink-muted)]">
            Library is empty.
          </div>
          <Link
            href="/"
            className="inline-block mt-3 font-mono text-[12px] text-[var(--color-accent-vocal)] underline"
          >
            bring a song
          </Link>
        </div>
      )}

      <div className="h-[40px]" />
    </PhoneFrame>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-6 pt-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ink-muted)] mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  t,
  palette,
  onClick,
  icon,
}: {
  t: TrackSummary;
  palette: { bg: string; fg: string };
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 py-3 border-t border-[var(--color-border-soft)] text-left"
    >
      <div
        className="w-12 h-12 rounded-md flex items-center justify-center"
        style={{ background: palette.bg, color: palette.fg }}
      >
        <span className="font-serif italic text-[24px] leading-none">{initials(t.title)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[19px] text-ink leading-[1.1] truncate">{t.title}</div>
        <div className="font-mono text-[11px] text-[var(--color-ink-muted)] truncate">{fmtMeta(t)}</div>
      </div>
      {icon}
    </button>
  );
}
