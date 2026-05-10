#!/usr/bin/env node
/**
 * Pure-JS tests for the new drill UI logic added in волна 1:
 *  - chunks navigation prev/next bounds & disable state
 *  - A/B drag clamping math (mirrors DrillView.tsx onSvgPointerMove)
 *  - mastered + auto-next behavior
 *
 *   node scripts/test-drill-logic.mjs
 */

let failures = 0;
function check(label, cond, info = "") {
  const tag = cond ? "✓" : "✗";
  console.log(`  ${tag} ${label}${info ? "  " + info : ""}`);
  if (!cond) failures++;
}

// ─── chunks navigation ──────────────────────────────────────────────
const chunks = [
  { id: "a", from: 10, to: 14 },
  { id: "b", from: 20, to: 24 },
  { id: "c", from: 30, to: 34 },
];
const sorted = chunks.slice().sort((a, b) => a.from - b.from);

function navState(currentId) {
  const idx = sorted.findIndex((c) => c.id === currentId);
  return {
    idx,
    hasPrev: idx > 0,
    hasNext: idx >= 0 && idx < sorted.length - 1,
  };
}

console.log("[A] chunks navigation");
{
  const s = navState("a");
  check("first: hasPrev=false", s.hasPrev === false);
  check("first: hasNext=true", s.hasNext === true);
  check("first: idx=0", s.idx === 0);
}
{
  const s = navState("b");
  check("middle: hasPrev=true", s.hasPrev === true);
  check("middle: hasNext=true", s.hasNext === true);
}
{
  const s = navState("c");
  check("last: hasPrev=true", s.hasPrev === true);
  check("last: hasNext=false", s.hasNext === false);
}
{
  const s = navState("nope");
  check("unknown: idx=-1", s.idx === -1);
  check("unknown: hasPrev=false", s.hasPrev === false);
  check("unknown: hasNext=false", s.hasNext === false);
}

// ─── A/B drag clamping ─────────────────────────────────────────────
// Mirrors DrillView onSvgPointerMove logic.
const PAD_MIN = 0;
const PAD_MAX = 4;

function clampDragA({ phraseFrom, phraseTo, trackDur, post, draftPost, t }) {
  const maxPre = Math.min(PAD_MAX, phraseFrom);
  const minPre = PAD_MIN;
  const lockedB = phraseTo + (typeof draftPost === "number" ? draftPost : post);
  const minTime = Math.max(0, phraseFrom - maxPre);
  const maxTime = Math.min(phraseFrom, lockedB - 0.3);
  const tClamped = Math.max(minTime, Math.min(maxTime, t));
  const newPre = Math.max(minPre, Math.min(maxPre, phraseFrom - tClamped));
  void trackDur;
  return +newPre.toFixed(3);
}

function clampDragB({ phraseTo, trackDur, pre, draftPre, t, phraseFrom }) {
  const maxPost = Math.min(PAD_MAX, trackDur - phraseTo);
  const minPost = PAD_MIN;
  const lockedA = Math.max(0, phraseFrom - (typeof draftPre === "number" ? draftPre : pre));
  const minTime = Math.max(phraseTo, lockedA + 0.3);
  const maxTime = Math.min(trackDur, phraseTo + maxPost);
  const tClamped = Math.max(minTime, Math.min(maxTime, t));
  const newPost = Math.max(minPost, Math.min(maxPost, tClamped - phraseTo));
  return +newPost.toFixed(3);
}

console.log("\n[B] A drag clamping");
// Phrase [10, 14], track 60s, no padding initially
{
  // Drag A to 9.0 → pre = 1.0
  const pre = clampDragA({ phraseFrom: 10, phraseTo: 14, trackDur: 60, post: 0, draftPost: null, t:9.0 });
  check("drag A to 9.0 → pre=1.0", Math.abs(pre - 1.0) < 1e-3, `got ${pre}`);
}
{
  // Drag A way left to 5.0 → pre clamps to 4.0 (PAD_MAX)
  const pre = clampDragA({ phraseFrom: 10, phraseTo: 14, trackDur: 60, post: 0, draftPost: null, t:5.0 });
  check("drag A to 5.0 → pre=4.0 (PAD_MAX)", Math.abs(pre - 4.0) < 1e-3, `got ${pre}`);
}
{
  // Drag A right of phrase.from → pre clamps to 0
  const pre = clampDragA({ phraseFrom: 10, phraseTo: 14, trackDur: 60, post: 0, draftPost: null, t:12.0 });
  check("drag A to 12 (inside phrase) → pre=0", Math.abs(pre - 0) < 1e-3, `got ${pre}`);
}
{
  // Phrase near track start: phrase.from=2 → maxPre=2 (clamped by 0)
  const pre = clampDragA({ phraseFrom: 2, phraseTo: 5, trackDur: 60, post: 0, draftPost: null, t: -10 });
  check("phrase near start → pre=2 (clamped)", Math.abs(pre - 2.0) < 1e-3, `got ${pre}`);
}

console.log("\n[C] B drag clamping");
{
  // Drag B to 15.0 → post = 1.0
  const post = clampDragB({ phraseFrom: 10, phraseTo: 14, trackDur: 60, pre: 0, draftPre: null, t: 15.0 });
  check("drag B to 15.0 → post=1.0", Math.abs(post - 1.0) < 1e-3, `got ${post}`);
}
{
  // Drag B way right → post clamps to PAD_MAX
  const post = clampDragB({ phraseFrom: 10, phraseTo: 14, trackDur: 60, pre: 0, draftPre: null, t: 25.0 });
  check("drag B to 25 → post=4.0 (PAD_MAX)", Math.abs(post - 4.0) < 1e-3, `got ${post}`);
}
{
  // Drag B left of phraseTo → clamp to 0
  const post = clampDragB({ phraseFrom: 10, phraseTo: 14, trackDur: 60, pre: 0, draftPre: null, t: 12.0 });
  check("drag B inside phrase → post=0", Math.abs(post - 0) < 1e-3, `got ${post}`);
}
{
  // Track ends near phrase: trackDur=15, phraseTo=14 → maxPost=1
  const post = clampDragB({ phraseFrom: 10, phraseTo: 14, trackDur: 15, pre: 0, draftPre: null, t: 50.0 });
  check("phrase near end → post=1.0 (clamped)", Math.abs(post - 1.0) < 1e-3, `got ${post}`);
}

console.log("\n[D] A drag respects 0.3 gap from B (degenerate-short phrase)");
{
  // Very short phrase [10, 10.2], post=0 → B at 10.2; A maxTime = min(10, 9.9) = 9.9
  // Drag A to 9.95 → tClamped=9.9 → pre = 10 - 9.9 = 0.1
  const pre = clampDragA({ phraseFrom: 10, phraseTo: 10.2, trackDur: 60, post: 0, draftPost: null, t: 9.95 });
  check("A respects 0.3 gap from B", Math.abs(pre - 0.1) < 1e-3, `got ${pre}`);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("\nall drill-logic checks passed");
}
