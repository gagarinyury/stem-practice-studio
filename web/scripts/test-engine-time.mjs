#!/usr/bin/env node
/**
 * Pure-JS test of StemEngine's currentTime mapping in stretched mode.
 * Doesn't load WASM — just imports the math by reproducing the formula
 * from audio-engine.ts and verifying it stays correct under loop wraps,
 * different timeRatios, and seeking.
 *
 *   node scripts/test-engine-time.mjs
 */

let failures = 0;
function check(label, cond, info = "") {
  const tag = cond ? "✓" : "✗";
  console.log(`  ${tag} ${label}${info ? "  " + info : ""}`);
  if (!cond) failures++;
}

/** Mirrors the stretched branch of `get currentTime()` in audio-engine.ts. */
function stretchedCurrentTime({
  ctxNow,
  startCtxTime,
  startOffset,
  loop,
  timeRatio,
  isPlaying,
}) {
  const { from, to } = loop;
  const stretchedLen = (to - from) * timeRatio;
  let elapsedStretched = 0;
  if (isPlaying) {
    elapsedStretched =
      (startOffset - from) * timeRatio + (ctxNow - startCtxTime);
  } else {
    elapsedStretched = (startOffset - from) * timeRatio;
  }
  if (stretchedLen > 0) {
    elapsedStretched = ((elapsedStretched % stretchedLen) + stretchedLen) % stretchedLen;
  }
  return from + elapsedStretched / timeRatio;
}

console.log("[A] paused at A — currentTime should equal A");
{
  const t = stretchedCurrentTime({
    ctxNow: 5.0,
    startCtxTime: 0,
    startOffset: 10.0,
    loop: { from: 10, to: 14 },
    timeRatio: 1.0,
    isPlaying: false,
  });
  check("paused at A → 10.0", Math.abs(t - 10.0) < 1e-6, `got ${t}`);
}

console.log("\n[B] passthrough loop, played 1 sec — currentTime = A + 1");
{
  const t = stretchedCurrentTime({
    ctxNow: 1.0,
    startCtxTime: 0,
    startOffset: 10.0,
    loop: { from: 10, to: 14 },
    timeRatio: 1.0,
    isPlaying: true,
  });
  check("after 1s → 11.0", Math.abs(t - 11.0) < 1e-6, `got ${t}`);
}

console.log("\n[C] slow tempo (timeRatio=2.0), played 1 sec of stretched");
// Loop 4 sec original × 2.0 ratio = 8 sec stretched.
// 1 sec of stretched playback = 0.5 sec of original time.
{
  const t = stretchedCurrentTime({
    ctxNow: 1.0,
    startCtxTime: 0,
    startOffset: 10.0,
    loop: { from: 10, to: 14 },
    timeRatio: 2.0,
    isPlaying: true,
  });
  check("after 1s stretched → 10.5 original", Math.abs(t - 10.5) < 1e-6, `got ${t}`);
}

console.log("\n[D] fast tempo (timeRatio=0.5), played 1 sec");
// Loop 4 sec × 0.5 = 2 sec stretched.
// 1 sec of stretched = 2 sec of original.
{
  const t = stretchedCurrentTime({
    ctxNow: 1.0,
    startCtxTime: 0,
    startOffset: 10.0,
    loop: { from: 10, to: 14 },
    timeRatio: 0.5,
    isPlaying: true,
  });
  check("after 1s stretched → 12.0 original", Math.abs(t - 12.0) < 1e-6, `got ${t}`);
}

console.log("\n[E] loop wrap — passthrough, 5 sec elapsed in 4-sec loop");
{
  const t = stretchedCurrentTime({
    ctxNow: 5.0,
    startCtxTime: 0,
    startOffset: 10.0,
    loop: { from: 10, to: 14 },
    timeRatio: 1.0,
    isPlaying: true,
  });
  // Should wrap: 5 sec → 1 sec into next loop iteration → 11.0
  check("wraps to 11.0", Math.abs(t - 11.0) < 1e-6, `got ${t}`);
}

console.log("\n[F] resume from middle of loop — startOffset=12 (middle of [10,14])");
{
  const t = stretchedCurrentTime({
    ctxNow: 0,
    startCtxTime: 0,
    startOffset: 12.0,
    loop: { from: 10, to: 14 },
    timeRatio: 1.5,
    isPlaying: false,
  });
  check("paused at 12.0 → 12.0", Math.abs(t - 12.0) < 1e-6, `got ${t}`);
}

console.log("\n[G] startAt computation for play() — stretched buffer offset");
// In play(), we compute startAt = (startOffset - loop.from) * timeRatio
// for a stretched buffer. Verify that for startOffset=11 (1 sec into a [10,14] loop)
// and timeRatio=2.0, startAt = 2.0 (2 sec into stretched buffer of length 8).
{
  const startOffset = 11.0;
  const loopFrom = 10.0;
  const timeRatio = 2.0;
  const startAt = (startOffset - loopFrom) * timeRatio;
  check("startAt of stretched buffer = 2.0", Math.abs(startAt - 2.0) < 1e-6, `got ${startAt}`);
}

console.log("\n[H] startOffset=A (loop start), should NOT skip first wraps");
{
  const t = stretchedCurrentTime({
    ctxNow: 0.001,
    startCtxTime: 0,
    startOffset: 10.0,
    loop: { from: 10, to: 14 },
    timeRatio: 1.0,
    isPlaying: true,
  });
  // 0.001 elapsed → 10.001
  check("just started → ~10.001", Math.abs(t - 10.001) < 1e-3, `got ${t}`);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("\nall time-mapping checks passed");
}
