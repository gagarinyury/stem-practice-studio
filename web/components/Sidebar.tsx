"use client";

import { useEffect, useState } from "react";
import {
  IconArrowRight,
  IconChevronLeft,
  IconLink,
  IconMoon,
  IconMusic,
  IconRefresh,
  IconLogout,
  IconSun,
  IconTrash,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";
import { deleteTrack, isDailyLimitError, isTrackLimitError, submitYouTube, uploadTrack, type TrackSummary, type User } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { LocaleSwitch } from "./LocaleSwitch";
import { useToast } from "./Toaster";

export const STUDENT_TRACK_LIMIT = 10;

interface Props {
  user: User | null;
  tracks: TrackSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onClose: () => void;
  onLogout: () => void;
  onTrackLimit: () => void;
  onDailyLimit: () => void;
  onSignInRequest: () => void;
}

export function Sidebar({ user, tracks, selectedId, onSelect, onRefresh, onClose, onLogout, onTrackLimit, onDailyLimit, onSignInRequest }: Props) {
  const { t: tr } = useI18n();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(false);
  const isAnon = !user;
  const unlimited = !isAnon && (user.role === "admin" || user.role === "tester");
  const limitReached = !isAnon && !unlimited && tracks.length >= STUDENT_TRACK_LIMIT;

  useEffect(() => {
    const stored = localStorage.getItem("stem-studio-theme");
    if (stored === "dark" || stored === "light") {
      document.documentElement.classList.toggle("dark", stored === "dark");
    }
    const isDark = document.documentElement.classList.contains("dark");
    setDark(isDark);
  }, []);

  async function onFile(file: File) {
    if (limitReached) {
      onTrackLimit();
      return;
    }
    setBusy(true);
    try {
      const r = await uploadTrack(file);
      onRefresh();
      onSelect(r.id);
    } catch (e) {
      if (isDailyLimitError(e)) onDailyLimit();
      else if (isTrackLimitError(e)) onTrackLimit();
      else toast.show((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function onUrl() {
    if (!url.trim()) return;
    if (limitReached) {
      onTrackLimit();
      return;
    }
    setBusy(true);
    try {
      const r = await submitYouTube(url.trim());
      setUrl("");
      onRefresh();
      onSelect(r.id);
    } catch (e) {
      if (isDailyLimitError(e)) onDailyLimit();
      else if (isTrackLimitError(e)) onTrackLimit();
      else toast.show((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(tr("sidebar.deleteConfirm"))) return;
    await deleteTrack(id);
    onRefresh();
  }

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("stem-studio-theme", next ? "dark" : "light");
    setDark(next);
  }

  return (
    <aside className="w-full h-full flex flex-col bg-[var(--color-surface)] shadow-[4px_0_24px_rgba(0,0,0,0.02)] relative z-50">
      <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border-soft)]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[22px] font-serif italic leading-none">stem studio</div>
            <div className="font-mono text-[9px] text-[var(--color-ink-muted)] tracking-[0.14em] mt-1.5 whitespace-nowrap">
              STEMS · LOOPS · KARAOKE
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-md text-[var(--color-ink-muted)] hover:text-ink hover:bg-[var(--color-surface-muted)] transition-colors"
            title={tr("sidebar.hideSidebar")}
          >
            <IconChevronLeft size={18} />
          </button>
        </div>
        {user ? (
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="font-mono text-[10px] text-[var(--color-ink-muted)] truncate" title={user.email}>
              {user.email}
            </div>
            <button
              onClick={onLogout}
              className="shrink-0 p-1 rounded-md text-[var(--color-ink-faint)] hover:text-[var(--color-accent-warn)] hover:bg-[var(--color-surface-muted)] transition-colors"
              title={tr("sidebar.logout")}
            >
              <IconLogout size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onSignInRequest}
            className="mt-3 w-full font-mono text-[10px] tracking-[0.04em] text-[var(--color-accent-vocal)] hover:text-ink hover:bg-[var(--color-surface-muted)] transition-colors rounded-md py-1.5 border border-[var(--color-accent-vocal)]/40 hover:border-[var(--color-accent-vocal)]"
          >
            {tr("sidebar.signInCta")}
          </button>
        )}
      </div>

      {/* Upload */}
      <div className="px-5 py-4 border-b border-[var(--color-border-soft)] space-y-2.5">
        <label
          className="flex items-center gap-2 cursor-pointer text-[13px] font-mono text-ink hover:text-[var(--color-accent-vocal)]"
          onClick={(e) => {
            if (limitReached) {
              e.preventDefault();
              onTrackLimit();
            }
          }}
        >
          <IconUpload size={16} />
          <span>{busy ? tr("sidebar.uploading") : tr("sidebar.uploadAudio")}</span>
          <input
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </label>
        <div className="flex items-center gap-2">
          <IconLink size={16} className="text-[var(--color-ink-muted)] shrink-0" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="youtube url"
            disabled={busy}
            className="flex-1 min-w-0 bg-transparent border-b border-[var(--color-border-soft)] focus:border-[var(--color-ink)] outline-none font-mono text-[12px] py-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") onUrl();
            }}
          />
          <button
            type="button"
            onClick={onUrl}
            disabled={busy || !url.trim()}
            className="w-7 h-7 rounded-md border border-[var(--color-ink)] text-[var(--color-ink)] disabled:opacity-30 flex items-center justify-center hover:bg-[var(--color-ink)] hover:text-[var(--color-surface)] transition-colors"
            title={tr("sidebar.addYoutube")}
          >
            <IconArrowRight size={15} />
          </button>
        </div>
        {isAnon ? (
          <div className="font-mono text-[10px] text-[var(--color-ink-faint)] leading-relaxed">
            {tr("sidebar.anonHint")}
          </div>
        ) : !unlimited ? (
          <div className="font-mono text-[10px] text-[var(--color-ink-faint)]">
            {tr("sidebar.testLimitPrefix")} {tracks.length}/{STUDENT_TRACK_LIMIT}
          </div>
        ) : null}
      </div>

      {/* List */}
      {!isAnon && (
        <div className="flex items-center justify-between px-5 py-2 border-b border-[var(--color-border-soft)]">
          <div className="font-mono text-[10px] tracking-[0.08em] text-[var(--color-ink-muted)]">
            {tr("sidebar.tracksPrefix")} · {unlimited ? tracks.length : `${tracks.length}/${STUDENT_TRACK_LIMIT}`}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="text-[var(--color-ink-muted)] hover:text-ink"
            title={tr("sidebar.refresh")}
          >
            <IconRefresh size={14} />
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto thin-scroll">
        {isAnon && (
          <div className="px-5 py-4 font-mono text-[10px] text-[var(--color-ink-muted)] leading-relaxed border-b border-[var(--color-border-soft)]">
            {tr("sidebar.historyForRegistered")}{" "}
            <button
              type="button"
              onClick={onSignInRequest}
              className="text-[var(--color-accent-vocal)] hover:underline"
            >
              {tr("sidebar.signInToKeep")}
            </button>
          </div>
        )}
        {!isAnon && tracks.length === 0 && (
          <div className="px-5 py-6 font-mono text-[11px] text-[var(--color-ink-faint)]">
            {tr("sidebar.empty")}
          </div>
        )}
        {tracks.map((t) => {
          const active = t.id === selectedId;
          const hasVideo = Boolean(t.source?.video);
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(t.id) }}
              className={`group w-full text-left px-5 py-3 border-b border-[var(--color-border-soft)] flex items-start gap-3 transition-colors cursor-pointer ${
                active ? "bg-[var(--color-accent-vocal-50)]" : "hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              <StatusDot status={t.status} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-serif italic leading-tight truncate">
                  {t.title || "—"}
                </div>
                <div className="font-mono text-[10px] text-[var(--color-ink-muted)] min-w-0 flex items-center gap-1.5">
                  <MediaBadge hasVideo={hasVideo} />
                  <span className="truncate">
                    {t.artist || "unknown"} · {t.language}
                    {t.duration ? ` · ${fmtDur(t.duration)}` : ""}
                  </span>
                </div>
                {t.status !== "done" && (
                  <div
                    className={`font-mono text-[10px] mt-0.5 ${
                      t.status === "failed"
                        ? "text-[var(--color-accent-warn)]"
                        : "text-[var(--color-accent-vocal)]"
                    }`}
                  >
                    {t.status}
                    {t.error ? ` · ${t.error}` : ""}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => onDelete(t.id, e)}
                className="opacity-0 group-hover:opacity-100 text-[var(--color-ink-faint)] hover:text-[var(--color-accent-warn)] mt-0.5"
                title={tr("sidebar.delete")}
              >
                <IconTrash size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="px-4 py-2.5 border-t border-[var(--color-border-soft)] flex items-center justify-between gap-2">
        <LocaleSwitch />
        <button
          type="button"
          onClick={toggleTheme}
          className="p-1.5 rounded-md text-[var(--color-ink-muted)] hover:text-ink hover:bg-[var(--color-surface-muted)] transition-colors"
          title={dark ? tr("sidebar.lightTheme") : tr("sidebar.darkTheme")}
          aria-label={dark ? tr("sidebar.lightTheme") : tr("sidebar.darkTheme")}
        >
          {dark ? <IconSun size={15} /> : <IconMoon size={15} />}
        </button>
      </div>
    </aside>
  );
}

function MediaBadge({ hasVideo }: { hasVideo: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1 rounded-sm border px-1 py-[1px] text-[8px] leading-none tracking-[0.06em] ${
        hasVideo
          ? "border-[var(--color-accent-vocal)]/35 text-[var(--color-accent-vocal)] bg-[var(--color-accent-vocal-50)]"
          : "border-[var(--color-border-soft)] text-[var(--color-ink-muted)] bg-[var(--color-surface)]"
      }`}
      title={hasVideo ? t("sidebar.hasVideo") : t("sidebar.audioOnly")}
    >
      {hasVideo ? <IconVideo size={9} /> : <IconMusic size={9} />}
      {hasVideo ? "VIDEO" : "AUDIO"}
    </span>
  );
}

function StatusDot({ status }: { status: TrackSummary["status"] }) {
  const color =
    status === "done"
      ? "var(--color-accent-success)"
      : status === "failed"
      ? "var(--color-accent-warn)"
      : "var(--color-accent-vocal)";
  return (
    <span
      className="mt-[6px] w-[6px] h-[6px] rounded-full shrink-0"
      style={{ background: color }}
    />
  );
}

function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}
