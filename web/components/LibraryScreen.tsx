"use client";

import { useRef, useState } from "react";
import { IconLink, IconLoader2, IconPlayerPlay, IconUpload } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScreenShell } from "./ui/ScreenShell";
import { ScreenHeader } from "./ui/ScreenHeader";
import { MonoSmall, Label, ButtonText, ErrorText } from "./ui/text";
import { submitYouTube, uploadTrack, type TrackSummary } from "@/lib/api";
import { t } from "@/lib/strings";

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

function fmtMeta(tr: TrackSummary): string {
  if (tr.status === "processing" || tr.status === "queued") return `${tr.artist || ""} · ${t.library.statusProcessing}`.trim();
  if (tr.status === "failed") return `${tr.artist || ""} · ${t.library.statusFailed}`.trim();
  return [tr.artist, tr.duration ? `${Math.round(tr.duration / 60)}:${String(Math.round(tr.duration % 60)).padStart(2, "0")}` : null]
    .filter(Boolean)
    .join(" · ");
}

export function LibraryScreen({ tracks }: { tracks: TrackSummary[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function startYouTube() {
    if (!url.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const { id } = await submitYouTube(url.trim());
      router.push(`/processing/${id}`);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  async function startUpload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const { id } = await uploadTrack(file);
      router.push(`/processing/${id}`);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text);
    } catch {
      /* clipboard denied — ignore */
    }
  }

  const inProgress = tracks.filter((tr) => tr.status === "processing" || tr.status === "queued");
  const done = tracks.filter((tr) => tr.status === "done");

  return (
    <ScreenShell variant="flow">
      <ScreenHeader
        eyebrow={t.library.eyebrow}
        title={t.library.titleA}
        emphasis={t.library.titleB}
      />

      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={pasteFromClipboard}
          className="w-full text-left bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-lg)] px-3.5 py-3 flex items-center gap-2.5"
        >
          <IconLink size={16} className="text-[var(--color-ink-muted)]" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t.library.urlPlaceholder}
            suppressHydrationWarning
            className="flex-1 bg-transparent font-mono text-[13px] text-ink placeholder:text-[var(--color-ink-muted)] outline-none"
            onClick={(e) => e.stopPropagation()}
          />
          <span className="font-mono text-[10px] text-[var(--color-accent-vocal)] tracking-[0.05em]">{t.library.paste}</span>
        </button>

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex-1 bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] py-3 flex items-center justify-center gap-2"
          >
            <IconUpload size={18} className="text-[#5F5E5A]" />
            <MonoSmall className="text-ink">{t.library.audioFile}</MonoSmall>
          </button>
          {url.trim() && (
            <button
              type="button"
              onClick={startYouTube}
              disabled={busy}
              className="flex-1 bg-[var(--color-ink)] text-[var(--color-paper)] rounded-pill disabled:opacity-60"
            >
              <ButtonText className="text-[var(--color-paper)]">
                {busy ? t.library.queueing : t.library.process}
              </ButtonText>
            </button>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*"
          suppressHydrationWarning
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) startUpload(f);
          }}
        />

        {err && <ErrorText>{err}</ErrorText>}
      </div>

      <div className="flex gap-2 overflow-x-auto">
        <span className="relative font-mono text-[11px] pl-5 pr-3 py-1.5 rounded-pill bg-[var(--color-surface-muted)] text-[var(--color-ink)] whitespace-nowrap">
          <span aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[var(--color-accent-vocal)]" />
          {t.library.allChip} · {tracks.length}
        </span>
        {inProgress.length > 0 && (
          <span className="font-mono text-[11px] px-3 py-1.5 rounded-pill border border-[var(--color-border-soft)] text-[var(--color-ink-muted)] whitespace-nowrap">
            {t.library.inProgressChip} · {inProgress.length}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-6 -mr-2 pr-2">
        {inProgress.length > 0 && (
          <Section label={t.library.inProgressSection}>
            {inProgress.map((tr, i) => (
              <Row
                key={tr.id}
                t={tr}
                palette={PALETTE[i % PALETTE.length]}
                onClick={() => router.push(`/processing/${tr.id}`)}
                icon={<IconLoader2 size={16} className="text-[var(--color-accent-vocal)] animate-spin" />}
              />
            ))}
          </Section>
        )}

        {done.length > 0 && (
          <Section label={t.library.readySection}>
            {done.map((tr, i) => (
              <Row
                key={tr.id}
                t={tr}
                palette={PALETTE[i % PALETTE.length]}
                onClick={() => router.push(`/play/${tr.id}`)}
                icon={<IconPlayerPlay size={18} className="text-ink" />}
              />
            ))}
          </Section>
        )}

        {tracks.length === 0 && (
          <div className="py-8 text-center flex flex-col gap-3 items-center">
            <MonoSmall>{t.library.empty}</MonoSmall>
            <Link href="/" className="font-mono text-[12px] text-[var(--color-accent-vocal)] underline">
              {t.library.bringSong}
            </Link>
          </div>
        )}
      </div>
    </ScreenShell>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <Label className="mb-2 block">{label}</Label>
      {children}
    </div>
  );
}

function Row({
  t: tr,
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
        <span className="font-serif italic text-[24px] leading-none">{initials(tr.title)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-serif text-[19px] text-ink leading-[1.1] truncate">{tr.title}</div>
        <div className="font-mono text-[11px] text-[var(--color-ink-muted)] truncate">{fmtMeta(tr)}</div>
      </div>
      {icon}
    </button>
  );
}
