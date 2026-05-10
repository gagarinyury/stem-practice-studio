/**
 * Daily 8 protocol — 7 exercises, 8 minutes total. Same shape as
 * docs/warmup/proto/daily8.html. Note names here are templates that
 * `transpose.ts` adjusts based on the user's voice range.
 */

export type StepKey = "release" | "sovt" | "siren" | "scale" | "swell" | "stacc" | "cool";

export interface WarmupStep {
  key: StepKey;
  eyebrow: string;
  /** HTML-allowed for italic emphasis on last word. */
  title: string;
  meta: string;
  duration: number; // seconds
  tip: string;
  tipTone: "mint" | "warm";
}

export const DAILY8: WarmupStep[] = [
  {
    key: "release",
    eyebrow: "— body release —",
    title: 'Open the <em>jaw.</em>',
    meta: "yawn-sigh · shake it loose",
    duration: 60,
    tip: "Drop the jaw, let the sigh out. No singing yet.",
    tipTone: "mint",
  },
  {
    key: "sovt",
    eyebrow: "— sovt primer —",
    title: 'Lip trills <em>or</em> straw.',
    meta: 'pick one · gentle "brrr" or sing through a straw',
    duration: 90,
    tip: "Half-closed tract = back-pressure. Safest way to wake the cords.",
    tipTone: "mint",
  },
  {
    key: "siren",
    eyebrow: "— sirens —",
    title: 'Slide <em>low</em> to high.',
    meta: 'on "ng" · low → high → low, smooth',
    duration: 60,
    tip: "Don't push at the top. If it strains, lower the target — comfort wins.",
    tipTone: "mint",
  },
  {
    key: "scale",
    eyebrow: "— vowel scales —",
    title: 'Climb the <em>steps.</em>',
    meta: "5-note scale · rotate ah / ee / oo",
    duration: 90,
    tip: "Each vowel sits in a different resonator. Feel the shift.",
    tipTone: "mint",
  },
  {
    key: "swell",
    eyebrow: "— messa di voce —",
    title: 'Soft to <em>loud</em>, back.',
    meta: "one note · grow and shrink, smoothly",
    duration: 60,
    tip: "Volume only. Same pitch. Breath does the work.",
    tipTone: "warm",
  },
  {
    key: "stacc",
    eyebrow: "— staccato —",
    title: 'Clean <em>onsets.</em>',
    meta: "1 · 3 · 5 · 8 · short, precise",
    duration: 60,
    tip: "Light, not hard. The cord touches — doesn't slam.",
    tipTone: "warm",
  },
  {
    key: "cool",
    eyebrow: "— cool-down —",
    title: 'Hum it <em>down.</em>',
    meta: "mid note · gentle, closed mouth",
    duration: 60,
    tip: "Easy. This settles the cords like a stretch after a run.",
    tipTone: "mint",
  },
];

export const DAILY8_TOTAL_SEC = DAILY8.reduce((s, x) => s + x.duration, 0);
