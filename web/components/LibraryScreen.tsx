"use client";

import { useRef, useState } from "react";
import { IconLink, IconLoader2, IconPlayerPlay, IconTrash, IconUpload } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScreenShell } from "./ui/ScreenShell";
import { ScreenHeader } from "./ui/ScreenHeader";
import { MonoSmall, Label, ButtonText, ErrorText } from "./ui/text";
import { submitYouTube, uploadTrack, deleteTrack, type TrackSummary } from "@/lib/api";
import { isVideoFile, saveLocalVideo } from "@/lib/local-video";
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

export function LibraryScreen({ tracks: initialTracks }: { tracks: TrackSummary[] }) {
  const router = useRouter();
  const [tracks, setTracks] = useState(initialTracks);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onDelete(id: string) {
    setTracks((prev) => prev.filter((tr) => tr.id !== id));
    try {
      await deleteTrack(id);
    } catch (e) {
      setErr(String(e));
    }
  }

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
      if (isVideoFile(file)) {
        saveLocalVideo(id, file).catch((e) => console.warn("local video save failed", e));
      }
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
          accept="audio/*,video/*,.mp3,.m4a,.wav,.flac,.aac,.ogg,.mp4,.mov,.webm"
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
                onDelete={() => onDelete(tr.id)}
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
                onDelete={() => onDelete(tr.id)}
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

const SWIPE_REVEAL = 88;
const SWIPE_THRESHOLD = 44;

function Row({
  t: tr,
  palette,
  onClick,
  onDelete,
  icon,
}: {
  t: TrackSummary;
  palette: { bg: string; fg: string };
  onClick: () => void;
  onDelete: () => void;
  icon: React.ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const startXRef = useRef<number | null>(null);
  const movedRef = useRef(false);

  function onTouchStart(e: React.TouchEvent) {
    startXRef.current = e.touches[0].clientX;
    movedRef.current = false;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startXRef.current === null) return;
    const dx = e.touches[0].clientX - startXRef.current;
    const base = open ? -SWIPE_REVEAL : 0;
    const next = Math.min(0, Math.max(-SWIPE_REVEAL - 20, base + dx));
    if (Math.abs(dx) > 4) movedRef.current = true;
    setOffset(next);
  }
  function onTouchEnd() {
    startXRef.current = null;
    if (offset < -SWIPE_THRESHOLD) {
      setOpen(true);
      setOffset(-SWIPE_REVEAL);
    } else {
      setOpen(false);
      setOffset(0);
    }
  }

  function handleClick(e: React.MouseEvent) {
    if (open) {
      e.preventDefault();
      setOpen(false);
      setOffset(0);
      return;
    }
    if (movedRef.current) {
      e.preventDefault();
      return;
    }
    onClick();
  }

  return (
    <div className="relative border-t border-[var(--color-border-soft)] overflow-hidden">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={t.library.delete}
        className="absolute inset-y-0 right-0 w-[88px] flex items-center justify-center bg-[var(--color-accent-warn)] text-[var(--color-paper)]"
      >
        <IconTrash size={20} stroke={1.6} />
      </button>
      <button
        type="button"
        onClick={handleClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{ transform: `translateX(${offset}px)`, transition: startXRef.current === null ? "transform 180ms ease-out" : "none" }}
        className="relative w-full flex items-center gap-3 py-3 text-left bg-paper"
      >
        <div
          className="w-12 h-12 rounded-md flex items-center justify-center shrink-0"
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
    </div>
  );
}
