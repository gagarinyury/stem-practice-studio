/**
 * Daily 8 protocol — 7 exercises, 8 minutes total. Same shape as
 * docs/warmup/proto/daily8.html. Note names here are templates that
 * `transpose.ts` adjusts based on the user's voice range.
 *
 * Localised copy (eyebrow, title, meta, tip) lives in `lib/strings/*` —
 * this file only carries the structural parts (key, duration, tip tone).
 */

export type StepKey = "release" | "sovt" | "siren" | "scale" | "swell" | "stacc" | "cool";

export interface WarmupStep {
  key: StepKey;
  duration: number; // seconds
  tipTone: "mint" | "warm";
}

export const DAILY8: WarmupStep[] = [
  { key: "release", duration: 60, tipTone: "mint" },
  { key: "sovt",    duration: 90, tipTone: "mint" },
  { key: "siren",   duration: 60, tipTone: "mint" },
  { key: "scale",   duration: 90, tipTone: "mint" },
  { key: "swell",   duration: 60, tipTone: "warm" },
  { key: "stacc",   duration: 60, tipTone: "warm" },
  { key: "cool",    duration: 60, tipTone: "mint" },
];

export const DAILY8_TOTAL_SEC = DAILY8.reduce((s, x) => s + x.duration, 0);
