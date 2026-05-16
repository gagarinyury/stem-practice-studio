"use client";

import { useEffect, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight, IconArrowsShuffle, IconRepeat, IconRepeatOff } from "@tabler/icons-react";
import type { StemEngine } from "@/lib/audio-engine";

// Butterchurn is imported dynamically inside the effect so it doesn't bloat
// the main bundle. Karaoke is an opt-in mode, so we pay this cost on demand.

interface Props {
  engine: StemEngine | null;
  /** Show the small preset controls bar. */
  showControls?: boolean;
  /** Optional control rendered at the start of the controls pill (e.g. VIDEO/VIZ toggle). */
  leadingControl?: React.ReactNode;
}

interface ButterchurnInstance {
  // Loose typing — butterchurn doesn't ship .d.ts
  connectAudio: (node: AudioNode) => void;
  render: () => void;
  loadPreset: (preset: unknown, blendTime?: number) => void;
  setRendererSize: (w: number, h: number) => void;
}

export function KaraokeVisualizer({ engine, showControls = true, leadingControl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const visRef = useRef<ButterchurnInstance | null>(null);
  const presetsRef = useRef<[string, unknown][]>([]);
  const presetIdxRef = useRef(0);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number>(0);

  const [presetName, setPresetName] = useState<string>("…");
  const [autoCycle, setAutoCycle] = useState(true);
  const [ready, setReady] = useState(false);

  // ── Mount: load butterchurn, init visualizer ───────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    if (!engine) return;

    let cancelled = false;
    let resizeObs: ResizeObserver | null = null;

    (async () => {
      const audioCtx = engine.audioContext;
      const analyser = engine.analyserNode;
      if (!audioCtx || !analyser) return;

      // Dynamic import — keeps karaoke code out of the main bundle.
      const [butterchurnMod, presetsMod] = await Promise.all([
        import("butterchurn"),
        import("butterchurn-presets"),
      ]);
      if (cancelled) return;
      const butterchurn = (butterchurnMod as unknown as { default: typeof butterchurnMod }).default ?? butterchurnMod;
      const butterchurnPresets = (presetsMod as unknown as { default: typeof presetsMod }).default ?? presetsMod;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vis = (butterchurn as any).createVisualizer(audioCtx, canvas, {
        width: canvas.width,
        height: canvas.height,
        pixelRatio: dpr,
      }) as ButterchurnInstance;
      vis.connectAudio(analyser);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const all: Record<string, unknown> = (butterchurnPresets as any).getPresets();
      const list = Object.entries(all);
      presetsRef.current = list;
      // Start with a random preset so it's not always the same one.
      presetIdxRef.current = Math.floor(Math.random() * list.length);

      visRef.current = vis;
      loadPreset(presetIdxRef.current, 0);
      setReady(true);

      // Render loop
      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        try {
          vis.render();
        } catch {
          // butterchurn may throw on certain preset+context combos; ignore
        }
      };
      tick();

      // Auto preset switch every 20s
      scheduleAutoSwitch();

      // Track size changes
      resizeObs = new ResizeObserver(() => {
        const ww = wrap.clientWidth;
        const hh = wrap.clientHeight;
        canvas.width = ww * dpr;
        canvas.height = hh * dpr;
        vis.setRendererSize(canvas.width, canvas.height);
      });
      resizeObs.observe(wrap);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      if (resizeObs) resizeObs.disconnect();
      visRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  // ── Auto-cycle scheduler updates whenever autoCycle changes ────────
  useEffect(() => {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    if (!autoCycle || !ready) return;
    scheduleAutoSwitch();
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCycle, ready]);

  function scheduleAutoSwitch() {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    autoTimerRef.current = setTimeout(() => {
      if (!autoCycle) return;
      const list = presetsRef.current;
      if (!list.length) return;
      const next = (presetIdxRef.current + 1) % list.length;
      presetIdxRef.current = next;
      loadPreset(next);
      scheduleAutoSwitch();
    }, 20_000);
  }

  function loadPreset(idx: number, blend?: number) {
    const vis = visRef.current;
    const list = presetsRef.current;
    if (!vis || !list.length) return;
    const [name, data] = list[idx];
    try {
      vis.loadPreset(data, blend ?? 2.5);
      setPresetName(prettyPresetName(name));
    } catch {
      // skip broken preset
    }
  }

  function step(delta: number) {
    const list = presetsRef.current;
    if (!list.length) return;
    const next = (presetIdxRef.current + delta + list.length) % list.length;
    presetIdxRef.current = next;
    loadPreset(next);
    if (autoCycle) scheduleAutoSwitch();
  }

  function random() {
    const list = presetsRef.current;
    if (!list.length) return;
    presetIdxRef.current = Math.floor(Math.random() * list.length);
    loadPreset(presetIdxRef.current);
    if (autoCycle) scheduleAutoSwitch();
  }

  return (
    <div ref={wrapRef} className="absolute inset-0 w-full h-full" aria-hidden="true">
      <canvas ref={canvasRef} className="w-full h-full block" />
      {showControls && ready && (
        <div className="absolute bottom-10 md:bottom-14 right-4 md:right-12 z-20 pointer-events-auto">
          <div className="flex items-center gap-0.5 bg-black/45 backdrop-blur-lg rounded-full border border-white/15 px-2 py-1.5 shadow-xl">
            {leadingControl}
            {leadingControl && <div className="w-px h-5 bg-white/15 mx-1" />}
            <button
              type="button"
              onClick={() => step(-1)}
              className="w-8 h-8 rounded-full text-white/75 hover:text-white hover:bg-white/12 flex items-center justify-center transition-colors active:scale-95"
              title="Previous preset"
              aria-label="Previous preset"
            >
              <IconChevronLeft size={16} stroke={2} />
            </button>
            <button
              type="button"
              onClick={random}
              className="w-8 h-8 rounded-full text-white/75 hover:text-white hover:bg-white/12 flex items-center justify-center transition-colors active:scale-95"
              title="Random preset"
              aria-label="Random preset"
            >
              <IconArrowsShuffle size={14} stroke={2} />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              className="w-8 h-8 rounded-full text-white/75 hover:text-white hover:bg-white/12 flex items-center justify-center transition-colors active:scale-95"
              title="Next preset"
              aria-label="Next preset"
            >
              <IconChevronRight size={16} stroke={2} />
            </button>
            <div className="w-px h-5 bg-white/15 mx-1" />
            <button
              type="button"
              onClick={() => setAutoCycle((v) => !v)}
              className={`w-8 h-8 rounded-full hover:bg-white/12 flex items-center justify-center transition-colors active:scale-95 ${autoCycle ? "text-white" : "text-white/35"}`}
              title={autoCycle ? "Auto-cycle: on (click to pause)" : "Auto-cycle: off (click to resume)"}
              aria-label="Toggle auto-cycle"
            >
              {autoCycle ? <IconRepeat size={14} stroke={2} /> : <IconRepeatOff size={14} stroke={2} />}
            </button>
            <div className="hidden sm:block max-w-[180px] truncate font-mono text-[10px] tracking-[0.04em] text-white/55 pl-2 pr-1.5">
              {presetName}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function prettyPresetName(raw: string): string {
  // Butterchurn preset names look like "$$$ Royal - Mashup (Wave)" — keep but trim creator prefix.
  return raw.replace(/^\$+\s*/, "").replace(/\.milk$/i, "");
}
