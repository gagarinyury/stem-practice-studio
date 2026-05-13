"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AlignedLyrics } from "@/lib/manifest";

interface Props {
  aligned: AlignedLyrics;
  currentTime: number;
}

const SLOT_H = 30; // px per line slot
const TRANS_MS = 280;

/**
 * Three-line reel: prev / current / next. The whole strip slides up by SLOT_H
 * when the current line changes (translateY transition), so lines glide in
 * smoothly instead of jumping.
 */
export function LyricsReel({ aligned, currentTime }: Props) {
  // Build a list of {lineIdx, text, start, end} that have aligned words.
  const lineMap = useMemo(() => {
    const groups = new Map<number, { start: number; end: number }>();
    for (const w of aligned.words) {
      const cur = groups.get(w.line);
      if (!cur) groups.set(w.line, { start: w.start, end: w.end });
      else {
        cur.start = Math.min(cur.start, w.start);
        cur.end = Math.max(cur.end, w.end);
      }
    }
    const arr: { idx: number; text: string; start: number; end: number }[] = [];
    [...groups.keys()].sort((a, b) => a - b).forEach((idx) => {
      const g = groups.get(idx)!;
      arr.push({ idx, text: aligned.lines[idx] ?? "", start: g.start, end: g.end });
    });
    return arr;
  }, [aligned]);

  const activeIdx = useMemo(() => {
    if (lineMap.length === 0) return 0;
    // Last line whose start <= currentTime; clamp to first.
    let lo = 0;
    for (let i = 0; i < lineMap.length; i++) {
      if (lineMap[i].start <= currentTime) lo = i;
      else break;
    }
    return lo;
  }, [lineMap, currentTime]);

  // Track previous active for transition animation.
  const prevActiveRef = useRef(activeIdx);
  const [transitionEnabled, setTransitionEnabled] = useState(false);
  useEffect(() => {
    if (prevActiveRef.current !== activeIdx) {
      setTransitionEnabled(true);
      const id = setTimeout(() => {
        prevActiveRef.current = activeIdx;
        setTransitionEnabled(false);
      }, TRANS_MS);
      return () => clearTimeout(id);
    }
  }, [activeIdx]);

  const baseIdx = transitionEnabled ? prevActiveRef.current : activeIdx;
  const direction = activeIdx >= prevActiveRef.current ? 1 : -1;

  // Render 5 slots so we have buffer above/below; the visible window is the middle 3.
  const slots = [-2, -1, 0, 1, 2].map((d) => {
    const i = baseIdx + d;
    return i >= 0 && i < lineMap.length ? lineMap[i] : null;
  });

  // translateY: shift the whole strip by direction * SLOT_H during transition.
  const translateY = transitionEnabled ? -direction * SLOT_H : 0;

  return (
    <div
      className="relative overflow-hidden mx-auto"
      style={{
        height: SLOT_H * 3,
        width: "100%",
        // Mask edges so the off-screen slots fade rather than pop.
        maskImage:
          "linear-gradient(to bottom, transparent 0, #000 22%, #000 78%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0, #000 22%, #000 78%, transparent 100%)",
      }}
    >
      <div
        className="absolute left-0 right-0"
        style={{
          top: -SLOT_H, // push slot[0] (-2) above visible window
          transform: `translateY(${translateY}px)`,
          transition: transitionEnabled ? `transform ${TRANS_MS}ms ease-out` : "none",
        }}
      >
        {slots.map((line, i) => {
          // Center slot of the visible window is i === 2 when baseIdx == activeIdx,
          // i === 1 during the upward transition (before settling).
          const isActive = transitionEnabled
            ? direction > 0
              ? i === 3
              : i === 1
            : i === 2;
          return (
            <div
              key={`${line?.idx ?? "empty"}-${i}`}
              className="flex items-center justify-center text-center px-4"
              style={{
                height: SLOT_H,
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: isActive ? 17 : 13,
                lineHeight: 1.05,
                color: isActive ? "#2C2C2A" : "#B4B2A9",
                transition: `font-size ${TRANS_MS}ms ease-out, color ${TRANS_MS}ms ease-out`,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {line?.text || "—"}
            </div>
          );
        })}
      </div>
    </div>
  );
}
