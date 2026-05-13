"use client";

/**
 * Winamp-style FFT spectrum visualizer for drill. Vertical bars rooted at
 * a flat baseline, segmented LED-block aesthetic, peak-hold cap that
 * floats and decays. Driven by StemEngine.tickSpectrum(buckets).
 *
 * Owns its own RAF loop — DrillView passes a ref-getter for the engine
 * so the component can poll without re-rendering DrillView.
 */
import { useEffect, useRef } from "react";
import type { StemEngine, Spectrum } from "@/lib/audio-engine";

interface Props {
  getEngine: () => StemEngine | null;
  bars?: number;
  height?: number;
}

const SEG_H = 3;        // px per LED segment in viewBox units
const SEG_GAP = 1;      // gap between segments
const PEAK_H = 2;       // peak-hold cap height
const VIEW_W = 320;     // matches waveform & ribbon width

export function EqualizerBars({ getEngine, bars = 28, height = 80 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const groupsRef = useRef<{ leds: SVGRectElement[]; peak: SVGRectElement }[]>([]);
  const lastSpectrumRef = useRef<Spectrum | null>(null);

  // Build the static SVG once (segments & peak rects). Subsequent frames
  // only mutate `fill-opacity` / `y` — no React re-render, no GC churn.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const usable = height - 4;          // 2px top + 2px bottom margin
    const numSegs = Math.max(4, Math.floor(usable / (SEG_H + SEG_GAP)));
    const totalGap = (bars - 1) * 2;
    const barW = (VIEW_W - totalGap) / bars;

    groupsRef.current = [];
    for (let b = 0; b < bars; b++) {
      const x = b * (barW + 2);
      const segs: SVGRectElement[] = [];
      for (let s = 0; s < numSegs; s++) {
        // Bottom-up: segment 0 is at the bottom.
        const y = height - 2 - (s + 1) * SEG_H - s * SEG_GAP;
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", x.toFixed(2));
        rect.setAttribute("y", y.toFixed(2));
        rect.setAttribute("width", barW.toFixed(2));
        rect.setAttribute("height", SEG_H.toString());
        rect.setAttribute("rx", "0.5");
        // Color zones: bottom 60% accent, middle 25% warm, top 15% bright
        const fracFromBottom = (s + 0.5) / numSegs;
        let fill: string;
        if (fracFromBottom < 0.6) fill = "var(--color-accent-vocal)";
        else if (fracFromBottom < 0.85) fill = "#D9A53B";
        else fill = "var(--color-accent-warn)";
        rect.setAttribute("fill", fill);
        rect.setAttribute("fill-opacity", "0.08");
        svg.appendChild(rect);
        segs.push(rect);
      }
      const peak = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      peak.setAttribute("x", x.toFixed(2));
      peak.setAttribute("y", (height - 2 - PEAK_H).toFixed(2));
      peak.setAttribute("width", barW.toFixed(2));
      peak.setAttribute("height", PEAK_H.toString());
      peak.setAttribute("fill", "var(--color-ink)");
      peak.setAttribute("fill-opacity", "0");
      svg.appendChild(peak);
      groupsRef.current.push({ leds: segs, peak });
    }
  }, [bars, height]);

  // RAF loop: pull spectrum from engine, paint bar segments + peaks.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const engine = getEngine();
      if (engine && groupsRef.current.length > 0) {
        const spec = engine.tickSpectrum(bars);
        lastSpectrumRef.current = spec;
        const usable = height - 4;
        for (let b = 0; b < bars; b++) {
          const grp = groupsRef.current[b];
          const lvl = Math.max(0, Math.min(1, (spec.left[b] + spec.right[b]) * 0.5));
          const peak = Math.max(0, Math.min(1, (spec.peakL[b] + spec.peakR[b]) * 0.5));
          const numSegs = grp.leds.length;
          const litCount = Math.round(lvl * numSegs);
          for (let s = 0; s < numSegs; s++) {
            grp.leds[s].setAttribute("fill-opacity", s < litCount ? "0.92" : "0.08");
          }
          // Peak cap floats above lit area
          if (peak > 0.02) {
            const peakSeg = Math.max(0, Math.min(numSegs - 1, Math.round(peak * numSegs)));
            const yPeak = height - 2 - (peakSeg + 1) * SEG_H - peakSeg * SEG_GAP - PEAK_H + 1;
            grp.peak.setAttribute("y", yPeak.toFixed(2));
            grp.peak.setAttribute("fill-opacity", "0.65");
          } else {
            grp.peak.setAttribute("fill-opacity", "0");
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bars, height, getEngine]);

  return (
    <div className="bg-white border border-[var(--color-border-soft)] rounded-[var(--radius-md)] px-2 py-2 mt-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${height}`}
        className="block w-full"
        preserveAspectRatio="none"
      />
    </div>
  );
}
