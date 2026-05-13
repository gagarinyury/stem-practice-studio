"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconRewindBackward15,
  IconRewindForward15,
  IconArrowsMaximize,
  IconPlayerTrackPrevFilled,
  IconLoader2,
} from "@tabler/icons-react";
import { StemEngine } from "@/lib/audio-engine";
import type { AlignedLyrics, AlignedWord, Manifest, StemKey } from "@/lib/manifest";
import { stemUrl } from "@/lib/manifest";
import { acceptLyricsCandidate, subscribeProgress, getTrack, getAligned, type TrackSummary, type ProgressEvent } from "@/lib/api";
import { API_BASE } from "@/lib/config";
import { StemMixer } from "./StemMixer";
import { Timeline } from "./Timeline";
import { LyricsPanel } from "./LyricsPanel";
import { LoopControls } from "./LoopControls";
import { KaraokeOverlay } from "./KaraokeOverlay";

const STEM_ORDER: StemKey[] = ["vocals", "drums", "bass", "guitar", "piano", "other"];

interface Props {
  manifest: Manifest;
  aligned: AlignedLyrics | null;
  processingTrack?: TrackSummary;
  onProcessingDone?: () => void;
}

export interface LoopRange {
  from: number;
  to: number;
  fromWordIdx?: number;
  toWordIdx?: number;
}

export function TrackView({ manifest: initialManifest, aligned: initialAligned, processingTrack, onProcessingDone }: Props) {
  const engineRef = useRef<StemEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loop, setLoop] = useState<LoopRange | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [tempo, setTempo] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [stretchBusy, setStretchBusy] = useState(false);
  const [karaokeOpen, setKaraokeOpen] = useState(false);
  const [vocalsMuted, setVocalsMuted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expanding, setExpanding] = useState(false);

  // Live manifest/aligned that update when processing completes
  const [manifest, setManifest] = useState(initialManifest);
  const [aligned, setAligned] = useState(initialAligned);
  const [progressEvent, setProgressEvent] = useState<ProgressEvent | null>(null);
  const [isProcessingLocal, setIsProcessingLocal] = useState(!!processingTrack);
  const isProcessing = isProcessingLocal;
  const hasStemFiles = Object.keys(manifest.stems).length > 0;
  const [engineDuration, setEngineDuration] = useState(0);
  const [processingSeconds, setProcessingSeconds] = useState(0);
  const [acceptingCandidate, setAcceptingCandidate] = useState<number | null>(null);

  useEffect(() => {
    setManifest(initialManifest);
    setAligned(initialAligned);
    setIsProcessingLocal(!!processingTrack);
    setProgressEvent(null);
    setAcceptingCandidate(null);
  }, [initialManifest.id]);

  // Timer for processing duration
  useEffect(() => {
    if (!isProcessing) return;
    setProcessingSeconds(0);
    const interval = setInterval(() => setProcessingSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isProcessing]);
  // Use engine-derived duration when manifest has none (processing mode)
  const effectiveDuration = manifest.duration || engineDuration;
  const lyricsNotice = getLyricsNotice(manifest);
  const lrcCandidates = manifest.lrc?.candidates ?? [];
  const showLrcCandidates = !!manifest.aligned?.asr_only && lrcCandidates.length > 0;

  // Determine if this manifest has a pre-merged "music" stem from the backend
  const hasMusic = !!manifest.stems["music"];

  // All individual instrument stems (excluding vocals and music)
  const individualStemKeys = STEM_ORDER.filter(
    (k) => k !== "vocals" && k !== "music" && manifest.stems[k],
  );

  // Load stems — or source.wav if still processing
  useEffect(() => {
    let cancelled = false;
    const engine = new StemEngine();
    engineRef.current = engine;
    setReady(false);
    setLoadError(null);
    setPlaying(false);
    setCurrentTime(0);
    setLoop(null);
    setTempo(1);
    setPitch(0);
    setExpanded(false);
    setExpanding(false);

    if (!hasStemFiles) {
      // Processing mode: wait for source.wav to appear, then load it
      const sourceRel = manifest.source?.stream || manifest.source?.audio || "source.wav";
      const sourceUrl = `${API_BASE}/runs/${manifest.id}/${sourceRel}`;
      let retryTimer: ReturnType<typeof setTimeout>;
      const waitForSource = async () => {
        try {
          const head = await fetch(sourceUrl, { method: "HEAD" });
          if (head.ok) {
            // File exists! Now load it into the engine
            try {
              await engine.load([{ key: "source", url: sourceUrl }]);
              if (!cancelled) {
                setEngineDuration(engine.totalDuration);
                setReady(true);
              }
            } catch {
              if (!cancelled) setLoadError("Не удалось загрузить аудио");
            }
            return;
          }
        } catch { /* network error, retry */ }
        // Not ready yet — retry in 2s
        if (!cancelled) retryTimer = setTimeout(waitForSource, 2000);
      };
      waitForSource();
      return () => { cancelled = true; clearTimeout(retryTimer); engine.dispose(); engineRef.current = null; };
    } else {
      // Normal mode: load vocals + music or all stems
      const phase1Keys: StemKey[] = hasMusic
        ? (["vocals", "music"] as StemKey[]).filter((k) => manifest.stems[k])
        : STEM_ORDER.filter((k) => manifest.stems[k]);
      const specs = phase1Keys.map((k) => ({
        key: k,
        url: stemUrl(manifest.id, manifest.stems[k]),
      }));
      engine
        .load(specs)
        .then(() => { if (!cancelled) setReady(true); })
        .catch((e) => { if (!cancelled) setLoadError((e as Error).message); });
    }

    return () => {
      cancelled = true;
      engine.dispose();
      engineRef.current = null;
    };
  }, [manifest.id, manifest.stems, manifest.source?.stream, manifest.source?.audio, hasStemFiles]);

  // Handle expand: hot-swap music → individual stems
  async function handleExpand() {
    if (!hasMusic || expanded || expanding) return;
    const engine = engineRef.current;
    if (!engine) return;
    setExpanding(true);
    try {
      const specs = individualStemKeys.map((k) => ({
        key: k,
        url: stemUrl(manifest.id, manifest.stems[k]),
      }));
      await engine.expandStems(specs);
      setExpanded(true);
    } catch (e) {
      console.error("Failed to expand stems:", e);
    } finally {
      setExpanding(false);
    }
  }

  // Subscribe to processing progress + auto-transition when done
  useEffect(() => {
    if (!isProcessing) return;
    let localLyricsLoaded = false;
    const applyProgressPatch = (ev: ProgressEvent) => {
      if (!ev.title && !ev.artist && !ev.source && !ev.lrc && !ev.aligned) return;
      setManifest((prev) => ({
        ...prev,
        title: ev.title ?? prev.title,
        artist: ev.artist ?? prev.artist,
        source: ev.source ?? prev.source,
        lrc: ev.lrc ?? prev.lrc,
        aligned: ev.aligned ?? prev.aligned,
      }));
    };
    const unsub = subscribeProgress(
      manifest.id,
      async (ev) => {
        setProgressEvent(ev);
        applyProgressPatch(ev);
        // Progressive disclosure: load lyrics as soon as the fast track finishes!
        if (ev.stage === "lyrics_ready" && !localLyricsLoaded) {
          localLyricsLoaded = true;
          try {
            const track = await getTrack(manifest.id);
            setManifest({ ...track, id: manifest.id });
            if (track.aligned?.path) {
              const newAligned = await getAligned(manifest.id, track.aligned.path);
              setAligned(newAligned);
            }
          } catch (e) {
            console.error("Failed to load early lyrics:", e);
            setLoadError(`early lyrics fail: ${(e as Error).message}`);
          }
        }
      },
      async (ev) => {
        if (ev.stage === "done") {
          setIsProcessingLocal(false);
          // Backend finished! Fetch the real manifest with stems
          // Update in-place — do NOT call onProcessingDone which
          // causes a full remount and loses audio state.
          try {
            const fullTrack = await getTrack(manifest.id);
            const newAligned = fullTrack.aligned?.path
              ? await getAligned(manifest.id, fullTrack.aligned.path)
              : null;
            setManifest({ ...fullTrack, id: manifest.id });
            setAligned(newAligned);
          } catch (e) {
            console.error("Failed to load completed track:", e);
          }
        }
      },
    );
    return unsub;
  }, [isProcessing, manifest.id]);  // RAF tick for playhead + playing state mirror
  useEffect(() => {
    let raf = 0;
    let lastPlaying = false;
    const tick = () => {
      const e = engineRef.current;
      if (e) {
        setCurrentTime(e.currentTime);
        const isPlaying = e.state === "playing";
        if (isPlaying !== lastPlaying) {
          lastPlaying = isPlaying;
          setPlaying(isPlaying);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Debounced rubberband apply on tempo/pitch/loop change
  useEffect(() => {
    if (!ready || !loop) return;
    const timeRatio = 1 / tempo;
    const pitchScale = Math.pow(2, pitch / 12);
    const t = setTimeout(async () => {
      const e = engineRef.current;
      if (!e) return;
      setStretchBusy(true);
      try {
        await e.setTimePitch(timeRatio, pitchScale, { from: loop.from, to: loop.to });
      } finally {
        setStretchBusy(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [ready, loop, tempo, pitch]);

  function togglePlay() {
    const e = engineRef.current;
    if (!e || !ready) return;
    e.unlock();
    e.toggle();
    setPlaying(e.state === "playing");
  }

  function seek(t: number) {
    const e = engineRef.current;
    if (!e) return;
    e.seek(t);
    setCurrentTime(e.currentTime);
  }

  function nudge(delta: number) {
    seek(Math.max(0, Math.min(effectiveDuration, currentTime + delta)));
  }

  function applyLoopRange(range: LoopRange | null) {
    setLoop(range);
    const e = engineRef.current;
    if (!e) return;
    if (range && loopEnabled) {
      e.setLoop({ from: range.from, to: range.to });
      const t = e.currentTime;
      if (t < range.from || t > range.to) e.seek(range.from);
    } else {
      e.setLoop(null);
    }
  }

  function onLoopChange(range: LoopRange) {
    // word indices invalid after manual move
    const next = { ...range, fromWordIdx: undefined, toWordIdx: undefined };
    setLoop(next);
    const e = engineRef.current;
    if (!e) return;
    if (loopEnabled) {
      e.setLoop({ from: range.from, to: range.to });
    }
  }

  function toggleLoopEnabled() {
    const next = !loopEnabled;
    setLoopEnabled(next);
    const e = engineRef.current;
    if (!e) return;
    if (next && loop) e.setLoop({ from: loop.from, to: loop.to });
    else e.setLoop(null);
  }

  function onSelectWords(fromIdx: number, toIdx: number) {
    if (!aligned) return;
    const words = aligned.words.slice(fromIdx, toIdx + 1);
    if (words.length === 0) return;
    const from = Math.min(...words.map((w: AlignedWord) => w.start));
    const to = Math.max(...words.map((w: AlignedWord) => w.end));
    applyLoopRange({ from, to, fromWordIdx: fromIdx, toWordIdx: toIdx });
  }

  function clearLoop() {
    applyLoopRange(null);
    setTempo(1);
    setPitch(0);
  }

  function toggleVocals() {
    const e = engineRef.current;
    if (!e) return;
    const next = !vocalsMuted;
    setVocalsMuted(next);
    // Determine the volume to restore if unmuting (we just assume 1.0 for simplicity from external toggle)
    if (next) e.setMuted("vocals", true);
    else {
      // Set to 1.0; StemMixer will reflect this next time it renders if it were controlled,
      // but StemMixer's internal volume is 1.0 by default. It's fine.
      e.setVolume("vocals", 1);
    }
  }

  function resetTempoPitch() {
    setTempo(1);
    setPitch(0);
  }

  async function confirmLrcCandidate(candidateId: number) {
    setAcceptingCandidate(candidateId);
    setLoadError(null);
    try {
      const track = await acceptLyricsCandidate(manifest.id, candidateId);
      setManifest({ ...track, id: manifest.id });
      if (track.aligned?.path) {
        const newAligned = await getAligned(manifest.id, track.aligned.path);
        setAligned(newAligned);
      }
    } catch (e) {
      setLoadError(`lyrics confirm fail: ${(e as Error).message}`);
    } finally {
      setAcceptingCandidate(null);
    }
  }

  function jumpToLoopStart() {
    if (loop) seek(loop.from);
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        nudge(-5);
      } else if (e.key === "ArrowRight") {
        nudge(5);
      } else if (e.key === "l" || e.key === "L") {
        if (loop) toggleLoopEnabled();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex h-full bg-[var(--color-paper)]">
      {/* Left Column: Lyrics and Timeline */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-8 py-4 border-b border-[var(--color-border-soft)] flex items-center gap-6 bg-[var(--color-surface)]">
          <div className="min-w-0">
            <div className="text-[26px] font-serif italic leading-none truncate text-ink">{manifest.title}</div>
            <div className="font-mono text-[11px] text-[var(--color-ink-muted)] mt-1 truncate">
              {manifest.artist}{manifest.artist && manifest.language ? " · " : ""}{manifest.language}{manifest.duration ? ` · ${fmtDur(manifest.duration)}` : ""}
            </div>
            {lyricsNotice && (
              <div className={`font-mono text-[10px] mt-2 inline-flex max-w-full items-center rounded-md border px-2 py-1 ${lyricsNotice.className}`}>
                <span className="truncate">{lyricsNotice.label}</span>
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {!ready && !loadError && (
              <div className="px-4 py-1.5 font-mono text-[11px] bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)] rounded-md animate-pulse flex items-center gap-2 border border-[var(--color-border-soft)]">
                <IconLoader2 size={14} className="animate-spin" />
                {isProcessing ? "загрузка оригинала…" : "скачивание и распаковка аудио…"}
              </div>
            )}
            {loadError && (
              <div className="px-4 py-1 font-mono text-[11px] text-[var(--color-accent-warn)]">
                ошибка загрузки: {loadError}
              </div>
            )}
            {aligned && (
              <button
                type="button"
                onClick={() => setKaraokeOpen(true)}
                className="font-mono text-[11px] tracking-[0.06em] px-4 py-2 rounded-lg bg-[var(--color-accent-vocal-50)] text-[var(--color-accent-vocal)] hover:bg-[var(--color-accent-vocal)] hover:text-white transition-colors shadow-sm font-bold flex items-center gap-2"
              >
                <IconArrowsMaximize size={16} />
                КАРАОКЕ
              </button>
            )}
          </div>
        </div>

        {/* Lyrics Panel (Top) — or processing placeholder */}
        <div className="flex-1 min-h-0 bg-[var(--color-paper)] relative shadow-[inset_0_-10px_20px_rgba(0,0,0,0.02)]">
          {aligned ? (
            <>
              {showLrcCandidates && (
                <div className="absolute left-8 right-8 top-4 z-20 rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)]/95 shadow-lg px-4 py-3">
                  <div className="font-mono text-[11px] text-[var(--color-ink-muted)] mb-2">
                    AI сомневается. Возможно, это этот трек:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {lrcCandidates.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => confirmLrcCandidate(candidate.id)}
                        disabled={acceptingCandidate != null}
                        className="max-w-full rounded-md border border-[var(--color-border-soft)] bg-[var(--color-surface-muted)] px-3 py-2 text-left hover:border-[var(--color-accent-vocal)] disabled:opacity-50"
                        title="Принять этот LRCLib текст"
                      >
                        <div className="font-mono text-[11px] text-ink truncate">
                          {acceptingCandidate === candidate.id ? "Загружаю текст..." : `${candidate.artist} - ${candidate.title}`}
                        </div>
                        <div className="font-mono text-[10px] text-[var(--color-ink-faint)]">
                          {candidate.synced ? "с таймингами" : "без таймингов"}{candidate.duration ? ` · ${fmtDur(candidate.duration)}` : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <LyricsPanel
                aligned={aligned}
                currentTime={currentTime}
                selection={
                  loop && loop.fromWordIdx != null && loop.toWordIdx != null
                    ? { from: loop.fromWordIdx, to: loop.toWordIdx }
                    : null
                }
                dragRange={loop ? { from: loop.from, to: loop.to } : null}
                onSelectWords={onSelectWords}
                onSeekWord={(w) => seek(w.start)}
              />
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center max-w-sm">
                {loadError ? (
                  <div className="text-[var(--color-accent-warn)] font-mono text-[12px] p-4 bg-[var(--color-accent-warn)]/10 rounded-lg">
                    {loadError}
                  </div>
                ) : (
                  <>
                    <IconLoader2 size={32} className="animate-spin text-[var(--color-accent-vocal)] mx-auto mb-4 opacity-60" />
                    <div className="font-mono text-[12px] text-[var(--color-ink-muted)] mb-2">
                      {progressEvent?.stage === "separate" ? "Нейросеть разделяет инструменты…" :
                       progressEvent?.stage === "asr" ? "Распознаём текст…" :
                       progressEvent?.stage === "align" ? "Синхронизируем слова…" :
                       progressEvent?.stage === "lrclib" ? "Ищем официальный текст…" :
                       "Подготовка текста…"}
                    </div>
                    <div className="font-mono text-[11px] text-[var(--color-ink-faint)] mb-4">
                      Прошло: {processingSeconds} сек.
                    </div>
                    {progressEvent?.pct != null && (
                      <div className="w-48 mx-auto h-1 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                        <div className="h-full bg-[var(--color-accent-vocal)] rounded-full transition-all duration-300" style={{ width: `${progressEvent.pct}%` }} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Timeline & Transport (Bottom) */}
        <div className="flex-shrink-0 border-t border-[var(--color-border-soft)] bg-[var(--color-surface)] px-8 pt-6 pb-8 shadow-2xl relative z-10">
          <Timeline
            duration={effectiveDuration}
            currentTime={currentTime}
            loop={loop}
            onSeek={seek}
            onLoopChange={onLoopChange}
          />

          <div className="mt-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => nudge(-15)} className="text-[var(--color-ink-muted)] hover:text-[var(--color-accent-vocal)] transition-colors p-2" disabled={!ready} title="−15s (←)">
                <IconRewindBackward15 size={24} />
              </button>
              <button
                type="button"
                onClick={togglePlay}
                disabled={!ready}
                className={`relative w-14 h-14 rounded-full bg-[var(--color-accent-vocal)] text-white shadow-lg flex items-center justify-center disabled:opacity-30 transition-transform active:scale-95 ${
                  playing ? "" : "hover:scale-105"
                }`}
                title="space"
              >
                {playing && ready && (
                  <span className="absolute inset-0 rounded-full border-2 border-[var(--color-accent-vocal)] animate-ping opacity-60" />
                )}
                {!ready ? (
                  <IconLoader2 size={28} className="animate-spin" />
                ) : playing ? (
                  <IconPlayerPauseFilled size={28} />
                ) : (
                  <IconPlayerPlayFilled size={28} className="ml-1" />
                )}
              </button>
              <button type="button" onClick={() => nudge(15)} className="text-[var(--color-ink-muted)] hover:text-[var(--color-accent-vocal)] transition-colors p-2" disabled={!ready} title="+15s (→)">
                <IconRewindForward15 size={24} />
              </button>
              {loop && (
                <button
                  type="button"
                  onClick={jumpToLoopStart}
                  className="text-[var(--color-ink-muted)] hover:text-[var(--color-accent-vocal)] transition-colors p-2"
                  title="К началу loop"
                >
                  <IconPlayerTrackPrevFilled size={20} />
                </button>
              )}
            </div>

            <div className="flex flex-col items-end gap-1">
              <div className="font-mono text-[16px] text-ink font-bold tabular-nums">
                {fmtT(currentTime)} <span className="text-[var(--color-ink-faint)] text-[14px]">/ {fmtT(effectiveDuration)}</span>
              </div>
              <div className="font-mono text-[10px] text-[var(--color-ink-faint)] tracking-[0.06em]">
                SPACE play · ← → ±5s · L loop
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: StemMixer and LoopControls */}
      <div className="w-[240px] flex-shrink-0 flex flex-col border-l border-[var(--color-border-soft)] bg-[var(--color-surface-muted)] overflow-y-auto thin-scroll z-20">
        <div className="p-4">
          <h3 className="font-serif italic text-[18px] mb-3 text-ink flex items-center gap-2">
            Mixer
          </h3>
          {hasStemFiles ? (
            <StemMixer
              engineRef={engineRef}
              stems={expanded
                ? STEM_ORDER.filter((k) => k !== "music" && manifest.stems[k])
                : (hasMusic
                    ? (["vocals", "music"] as StemKey[]).filter((k) => manifest.stems[k])
                    : STEM_ORDER.filter((k) => manifest.stems[k]))
              }
              ready={ready}
              vocalsMuted={vocalsMuted}
              onToggleVocals={toggleVocals}
              isExpanded={expanded}
              isExpanding={expanding}
              onExpand={hasMusic ? handleExpand : undefined}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--color-ink-faint)] bg-[var(--color-surface)]/50 px-4 py-8 text-center">
              <IconLoader2 size={20} className="animate-spin text-[var(--color-accent-vocal)] mx-auto mb-3 opacity-60" />
              <div className="font-mono text-[11px] text-[var(--color-ink-muted)]">
                Нейросеть разделяет трек на дорожки…
              </div>
              <div className="font-mono text-[11px] text-[var(--color-ink-faint)] mt-1">
                Прошло: {processingSeconds} сек.
              </div>
              {progressEvent?.pct != null && progressEvent.pct < 70 && (
                <div className="w-full mt-3 h-1 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--color-accent-vocal)] rounded-full transition-all duration-300" style={{ width: `${Math.min(progressEvent.pct, 70) / 70 * 100}%` }} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-px w-full bg-[var(--color-border-soft)]" />

        <div className="p-4">
          <h3 className="font-serif italic text-[18px] mb-3 text-ink">
            Controls
          </h3>
          {loop ? (
            <LoopControls
              loop={loop}
              duration={effectiveDuration}
              enabled={loopEnabled}
              tempo={tempo}
              pitch={pitch}
              processing={stretchBusy}
              onLoopChange={onLoopChange}
              onToggleEnabled={toggleLoopEnabled}
              onTempoChange={setTempo}
              onPitchChange={setPitch}
              onReset={resetTempoPitch}
              onClear={clearLoop}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--color-ink-faint)] bg-[var(--color-surface)]/50 px-4 py-6 text-center font-mono text-[11px] text-[var(--color-ink-muted)]">
              <div className="mb-2 text-[var(--color-ink-faint)]">
                <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path></svg>
              </div>
              Выделите слова в lyrics или растяните диапазон на таймлайне → появятся темп / тон / loop
            </div>
          )}
        </div>
      </div>
      {karaokeOpen && aligned && (
        <KaraokeOverlay
          manifest={manifest}
          aligned={aligned}
          currentTime={currentTime}
          playing={playing}
          vocalMuted={vocalsMuted}
          onTogglePlay={togglePlay}
          onToggleVocal={toggleVocals}
          onSeek={seek}
          onClose={() => setKaraokeOpen(false)}
        />
      )}
    </div>
  );
}

function fmtDur(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function fmtT(s: number): string {
  if (!isFinite(s)) return "0:00";
  return fmtDur(s);
}

function getLyricsNotice(manifest: Manifest): { label: string; className: string } | null {
  const reason = manifest.aligned?.reason || manifest.lrc?.reason;
  if (manifest.aligned?.partial || manifest.lrc?.partial) {
    return {
      label: "частичный текст: показан только совпавший фрагмент",
      className: "border-[var(--color-accent-vocal-100)] bg-[var(--color-accent-vocal-50)] text-[var(--color-accent-vocal-700)]",
    };
  }
  if (!manifest.aligned?.asr_only && !reason) return null;
  const labels: Record<string, string> = {
    lrclib_not_found: "Текст не найден автоматически",
    lrclib_rejected_low_match: "AI сомневается: можно выбрать найденный текст",
    script_mismatch: "AI сомневается: найденный текст не похож на запись",
    unsupported_or_weak_asr_language: "AI сомневается: можно выбрать найденный текст",
    partial_cover_available: "частичный текст: показан только совпавший фрагмент",
    user_confirmed_lrc: "текст выбран вручную: тайминги приблизительные",
  };
  return {
    label: labels[String(reason)] || "Показан распознанный текст",
    className: "border-[var(--color-border-soft)] bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]",
  };
}
