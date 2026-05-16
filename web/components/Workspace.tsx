"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconUpload } from "@tabler/icons-react";
import { Sidebar, STUDENT_TRACK_LIMIT } from "./Sidebar";
import { TrackView } from "./TrackView";
import { AuthScreen } from "./AuthScreen";
import { FeedbackModal } from "./FeedbackModal";
import { TrackLimitModal } from "./TrackLimitModal";
import { getMe, getTrack, getAligned, isDailyLimitError, isTrackLimitError, listTracks, logout, submitYouTube, uploadTrack, type TrackSummary, type User } from "@/lib/api";
import type { AlignedLyrics, Manifest } from "@/lib/manifest";
import { useI18n } from "@/lib/i18n";
import { useToast } from "./Toaster";

type FeedbackStatus = "pending" | "dismissed" | "submitted";

export function Workspace() {
  const { t } = useI18n();
  const toast = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [aligned, setAligned] = useState<AlignedLyrics | null>(null);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [processingTrack, setProcessingTrack] = useState<TrackSummary | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>("pending");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [trackLimitOpen, setTrackLimitOpen] = useState(false);
  const [dailyLimitOpen, setDailyLimitOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshTracks = useCallback(async () => {
    if (!user) {
      setTracks([]);
      return;
    }
    try {
      const list = await listTracks();
      setTracks(list.slice().reverse());
    } catch (err) {
      if ((err as Error).message.includes("401")) setUser(null);
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then(({ user }) => { if (!cancelled) setUser(user); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setAuthLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshTracks();
    pollRef.current = setInterval(refreshTracks, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshTracks, user]);

  useEffect(() => {
    if (!user) {
      setFeedbackOpen(false);
      setFeedbackStatus("pending");
      return;
    }
    try {
      const saved = localStorage.getItem(`stem-feedback-${user.id}`) as FeedbackStatus | null;
      setFeedbackStatus(saved === "dismissed" || saved === "submitted" ? saved : "pending");
    } catch {
      setFeedbackStatus("pending");
    }
    setFeedbackOpen(false);
  }, [user]);

  useEffect(() => {
    if (!user || feedbackStatus !== "pending" || tracks.length < 3) return;
    setFeedbackOpen(true);
  }, [feedbackStatus, tracks.length, user]);

  useEffect(() => {
    if (!selectedId) {
      setManifest(null);
      setAligned(null);
      return;
    }
    let cancelled = false;
    setLoadingTrack(true);
    setTrackError(null);
    setProcessingTrack(null);
    (async () => {
      try {
        const m = await getTrack(selectedId);
        if (cancelled) return;
        if (m.status !== "done" && m.status !== "failed") {
          setProcessingTrack(m);
          setManifest(null);
          setAligned(null);
          return;
        }
        if (m.status === "failed") {
          setTrackError(t("processing.error", { error: m.error || t("processing.unknownError") }));
          setManifest(null);
          setAligned(null);
          return;
        }
        const a = m.aligned?.path ? await getAligned(selectedId, m.aligned.path) : null;
        if (cancelled) return;
        setManifest({ ...m, id: selectedId });
        setAligned(a);
      } catch (e) {
        if (!cancelled) setTrackError((e as Error).message);
      } finally {
        if (!cancelled) setLoadingTrack(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const handleUpload = useCallback(async (kind: "file" | "url", payload: File | string) => {
    try {
      const r = kind === "file"
        ? await uploadTrack(payload as File)
        : await submitYouTube((payload as string).trim());
      await refreshTracks();
      setSelectedId(r.id);
    } catch (e) {
      if (isDailyLimitError(e)) setDailyLimitOpen(true);
      else if (isTrackLimitError(e)) setTrackLimitOpen(true);
      else toast.show((e as Error).message, "error");
    }
  }, [refreshTracks, toast]);

  async function handleLogout() {
    await logout().catch(() => {});
    setUser(null);
    setTracks([]);
    setSelectedId(null);
    setManifest(null);
    setAligned(null);
    setProcessingTrack(null);
  }

  function persistFeedbackStatus(next: FeedbackStatus) {
    setFeedbackStatus(next);
    setFeedbackOpen(false);
    if (!user) return;
    try {
      localStorage.setItem(`stem-feedback-${user.id}`, next);
    } catch {}
  }

  if (authLoading) {
    return <CenterMsg text={t("workspace.checkingAuth")} />;
  }

  return (
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-[var(--color-paper)] relative">
      {/* Mobile backdrop when sidebar open */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed overlay on mobile, push-flex on desktop */}
      <div
        className={`
          transition-all duration-300 ease-in-out h-full z-40
          fixed md:static inset-y-0 left-0
          ${sidebarOpen
            ? "translate-x-0 w-[300px] md:w-[280px]"
            : "-translate-x-full md:translate-x-0 w-[300px] md:w-0 md:overflow-hidden"}
        `}
      >
        <Sidebar
          user={user}
          tracks={tracks}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setSidebarOpen(false);
          }}
          onRefresh={refreshTracks}
          onClose={() => setSidebarOpen(false)}
          onLogout={handleLogout}
          onTrackLimit={() => setTrackLimitOpen(true)}
          onDailyLimit={() => setDailyLimitOpen(true)}
          onSignInRequest={() => setAuthOpen(true)}
        />
      </div>

      <main className="flex-1 flex flex-col min-w-0 border-l border-[var(--color-border-soft)] relative">
        {/* Toggle Sidebar Button */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute top-4 left-4 z-30 p-2 bg-[var(--color-surface)] border border-[var(--color-border-soft)] rounded-md text-ink hover:text-[var(--color-accent-vocal)] shadow-lg transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          </button>
        )}

        {selectedId == null ? (
          <EmptyState
            onFile={(f) => handleUpload("file", f)}
            onUrl={(u) => handleUpload("url", u)}
            onDemo={() => {
              const id = process.env.NEXT_PUBLIC_DEMO_TRACK_ID;
              if (id) setSelectedId(id);
            }}
          />
        ) : loadingTrack ? (
          <CenterMsg text={t("workspace.loadingManifest")} />
        ) : processingTrack ? (
          <TrackView
            manifest={{
              id: processingTrack.id,
              title: processingTrack.title || t("processing.short"),
              artist: processingTrack.artist || "",
              url: processingTrack.url || "",
              duration: processingTrack.duration || 0,
              language: processingTrack.language || "en",
              source: processingTrack.source ?? null,
              stems: {} as Record<string, string>,
              lyrics: { raw_asr: "", engine: "" },
              lrc: { found: false },
              aligned: null,
              timings_sec: {},
            }}
            aligned={null}
            processingTrack={processingTrack}
            onProcessingDone={() => {
              setProcessingTrack(null);
              refreshTracks();
              setSelectedId(null);
              setTimeout(() => setSelectedId(selectedId), 10);
            }}
          />
        ) : trackError ? (
          <CenterMsg text={trackError} tone="warn" />
        ) : manifest && aligned ? (
          <TrackView
            manifest={manifest}
            aligned={aligned}
            isAnon={!user}
            onSignInRequest={() => setAuthOpen(true)}
          />
        ) : manifest ? (
          <TrackView
            manifest={manifest}
            aligned={null}
            isAnon={!user}
            onSignInRequest={() => setAuthOpen(true)}
          />
        ) : null}
      </main>
      {feedbackOpen && (
        <FeedbackModal
          trackCount={tracks.length}
          onClose={() => persistFeedbackStatus("dismissed")}
          onSubmitted={() => persistFeedbackStatus("submitted")}
        />
      )}
      {trackLimitOpen && user && (
        <TrackLimitModal
          user={user}
          limit={STUDENT_TRACK_LIMIT}
          onClose={() => setTrackLimitOpen(false)}
        />
      )}
      {dailyLimitOpen && (
        <DailyLimitModal
          onSignIn={() => {
            setDailyLimitOpen(false);
            setAuthOpen(true);
          }}
          onClose={() => setDailyLimitOpen(false)}
        />
      )}
      {authOpen && (
        <AuthOverlay
          onClose={() => setAuthOpen(false)}
          onAuth={(u) => {
            setUser(u);
            setAuthOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AuthOverlay({ onAuth, onClose }: { onAuth: (u: import("@/lib/api").User) => void; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-sm flex items-center justify-center px-4 py-8 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[400px] rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-md text-[var(--color-ink-muted)] hover:text-ink hover:bg-[var(--color-surface-muted)] flex items-center justify-center transition-colors"
        >
          ×
        </button>
        <div className="px-6 pt-6 pb-2">
          <div className="font-serif italic text-[28px] leading-tight">{t("signup.modalTitle")}</div>
          <div className="font-mono text-[12px] text-[var(--color-ink-muted)] mt-1.5">
            {t("signup.modalSubtitle")}
          </div>
        </div>
        <div className="px-5 pb-5">
          <AuthScreen onAuth={onAuth} compact />
        </div>
      </div>
    </div>
  );
}

function DailyLimitModal({ onSignIn, onClose }: { onSignIn: () => void; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="max-w-[420px] w-full rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-serif italic text-[26px] mb-2 leading-tight">{t("limit.title")}</div>
        <div className="font-mono text-[13px] text-[var(--color-ink-muted)] leading-relaxed mb-5">
          {t("limit.body")}
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            onClick={onClose}
            className="sm:flex-none rounded-md border border-[var(--color-border-soft)] px-4 py-2.5 font-mono text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)] transition-colors"
          >
            {t("limit.later")}
          </button>
          <button
            type="button"
            onClick={onSignIn}
            className="flex-1 rounded-md bg-[var(--color-accent-vocal)] px-4 py-2.5 font-mono text-[13px] font-bold text-white hover:opacity-90 transition-opacity"
          >
            {t("limit.signUp")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onFile, onUrl, onDemo }: { onFile: (f: File) => void; onUrl: (u: string) => void; onDemo: () => void }) {
  const { t } = useI18n();
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const demoTrackId = process.env.NEXT_PUBLIC_DEMO_TRACK_ID;
  const stemLabels = ["vocals", "drums", "bass", "piano", "guitar"];
  return (
    <div
      className={`flex-1 flex items-center justify-center transition-colors px-4 ${dragOver ? "bg-[var(--color-accent-vocal-50)]" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <div className="text-center max-w-[460px] w-full">
        <div className="text-[36px] sm:text-[48px] leading-[1.05] font-serif italic mb-3">stem studio</div>
        <div className="text-[13px] sm:text-[14px] text-[var(--color-ink-muted)] font-mono mb-3 px-2">
          {t("empty.subtitle")}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5 mb-7">
          {stemLabels.map((label) => (
            <span
              key={label}
              className="font-mono text-[10px] tracking-[0.08em] uppercase px-2 py-0.5 rounded border border-[var(--color-border-soft)] text-[var(--color-ink-muted)]"
            >
              {label}
            </span>
          ))}
        </div>

        <label className="block cursor-pointer">
          <div className={`rounded-xl border-2 border-dashed px-6 py-8 transition-all ${dragOver ? "border-[var(--color-accent-vocal)] bg-[var(--color-accent-vocal-50)] scale-[1.01]" : "border-[var(--color-border-soft)] hover:border-[var(--color-accent-vocal)] hover:bg-[var(--color-surface-muted)]/30"}`}>
            <div className="flex justify-center mb-3">
              <div className="w-14 h-14 rounded-full bg-[var(--color-accent-vocal-50)] flex items-center justify-center text-[var(--color-accent-vocal)]">
                <IconUpload size={26} />
              </div>
            </div>
            <div className="font-mono text-[14px] text-ink mb-1">{t("empty.dropAudio")}</div>
            <div className="font-mono text-[12px] text-[var(--color-ink-muted)]">{t("empty.dropHint")}</div>
          </div>
          <input
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </label>

        <div className="mt-5 flex items-center gap-3">
          <div className="flex-1 h-px bg-[var(--color-border-soft)]" />
          <div className="font-mono text-[11px] tracking-[0.08em] text-[var(--color-ink-faint)]">{t("empty.or")}</div>
          <div className="flex-1 h-px bg-[var(--color-border-soft)]" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) {
              onUrl(url.trim());
              setUrl("");
            }
          }}
          className="mt-5 flex gap-2"
        >
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("empty.urlPlaceholder")}
            className="flex-1 min-w-0 rounded-md border border-[var(--color-border-soft)] bg-[var(--color-paper)] px-3 py-2.5 font-mono text-[13px] outline-none focus:border-[var(--color-accent-vocal)] transition-colors"
          />
          <button
            type="submit"
            disabled={!url.trim()}
            className="rounded-md bg-[var(--color-accent-vocal)] px-4 py-2.5 font-mono text-[12px] font-bold text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {t("empty.split")}
          </button>
        </form>

        {demoTrackId && (
          <button
            type="button"
            onClick={onDemo}
            className="mt-6 font-mono text-[12px] text-[var(--color-accent-vocal)] hover:underline"
          >
            {t("empty.tryDemo")}
          </button>
        )}
      </div>
    </div>
  );
}

function CenterMsg({ text, tone }: { text: string; tone?: "warn" }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div
        className={`font-mono text-[13px] ${
          tone === "warn" ? "text-[var(--color-accent-warn)]" : "text-[var(--color-ink-muted)]"
        }`}
      >
        {text}
      </div>
    </div>
  );
}
