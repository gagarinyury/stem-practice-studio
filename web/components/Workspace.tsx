"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar, STUDENT_TRACK_LIMIT } from "./Sidebar";
import { TrackView } from "./TrackView";
import { AuthScreen } from "./AuthScreen";
import { FeedbackModal } from "./FeedbackModal";
import { TrackLimitModal } from "./TrackLimitModal";
import { getMe, getTrack, getAligned, listTracks, logout, type TrackSummary, type User } from "@/lib/api";
import type { AlignedLyrics, Manifest } from "@/lib/manifest";

type FeedbackStatus = "pending" | "dismissed" | "submitted";

export function Workspace() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [aligned, setAligned] = useState<AlignedLyrics | null>(null);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [processingTrack, setProcessingTrack] = useState<TrackSummary | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>("pending");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [trackLimitOpen, setTrackLimitOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshTracks = useCallback(async () => {
    if (!user) return;
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
          setTrackError(`Ошибка обработки: ${m.error || "неизвестная ошибка"}`);
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
    return <CenterMsg text="Проверяем вход…" />;
  }

  if (!user) {
    return <AuthScreen onAuth={setUser} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-paper)] relative">
      {/* Sidebar Overlay/Slide */}
      <div
        className={`flex-shrink-0 transition-all duration-300 ease-in-out relative z-40 ${sidebarOpen ? "w-[240px] translate-x-0" : "w-0 -translate-x-full overflow-hidden"}`}
      >
        <div className="w-[240px] h-full">
          <Sidebar
            user={user}
            tracks={tracks}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRefresh={refreshTracks}
            onClose={() => setSidebarOpen(false)}
            onLogout={handleLogout}
            onTrackLimit={() => setTrackLimitOpen(true)}
          />
        </div>
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
          <EmptyState />
        ) : loadingTrack ? (
          <CenterMsg text="Загрузка манифеста…" />
        ) : processingTrack ? (
          <TrackView
            manifest={{
              id: processingTrack.id,
              title: processingTrack.title || "Обработка…",
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
          />
        ) : manifest ? (
          <TrackView
            manifest={manifest}
            aligned={null}
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
      {trackLimitOpen && (
        <TrackLimitModal
          user={user}
          limit={STUDENT_TRACK_LIMIT}
          onClose={() => setTrackLimitOpen(false)}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md px-8">
        <div className="text-[44px] leading-tight font-serif italic mb-3">stem studio</div>
        <div className="text-[14px] text-[var(--color-ink-muted)] font-mono">
          выбери трек слева или загрузи новый
        </div>
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
