#!/usr/bin/env node
/**
 * Unit tests for pitch.ts pure utilities (no DOM):
 *  - hzToMidi
 *  - centsDelta (with and without octave tolerance)
 *  - medianHz on a PitchCurve
 *  - pitchAt linear interpolation
 *
 *   node scripts/test-pitch.mjs
 */

let failures = 0;
function check(label, cond, info = "") {
  const tag = cond ? "✓" : "✗";
  console.log(`  ${tag} ${label}${info ? "  " + info : ""}`);
  if (!cond) failures++;
}

// Reproduce the helpers (pure-JS) so we can test without TS toolchain.
function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

function centsDelta(yourHz, targetHz, octaveTolerant = true) {
  if (!isFinite(yourHz) || !isFinite(targetHz) || yourHz <= 0 || targetHz <= 0) return Infinity;
  let cents = 1200 * Math.log2(yourHz / targetHz);
  if (octaveTolerant) {
    cents = ((cents + 600) % 1200 + 1200) % 1200 - 600;
  }
  return cents;
}

function medianHz(curve) {
  const valid = [];
  for (let i = 0; i < curve.hz.length; i++) {
    if (Number.isFinite(curve.hz[i])) valid.push(curve.hz[i]);
  }
  if (valid.length === 0) return 220;
  valid.sort((a, b) => a - b);
  return valid[Math.floor(valid.length / 2)];
}

function pitchAt(curve, t) {
  if (curve.times.length === 0) return NaN;
  const lo = Math.floor((t - curve.fromSec) / curve.hopSec);
  const hi = lo + 1;
  if (lo < 0 || hi >= curve.times.length) return NaN;
  const a = curve.hz[lo];
  const b = curve.hz[hi];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  const frac = (t - curve.times[lo]) / (curve.times[hi] - curve.times[lo]);
  return a + (b - a) * frac;
}

console.log("[A] hzToMidi");
check("A4 (440 Hz) → MIDI 69", Math.abs(hzToMidi(440) - 69) < 1e-6);
check("A3 (220 Hz) → MIDI 57", Math.abs(hzToMidi(220) - 57) < 1e-6);
check("C5 (~523.25 Hz) → MIDI 72", Math.abs(hzToMidi(523.25) - 72) < 0.01);

console.log("\n[B] centsDelta strict mode");
check("identical → 0c", Math.abs(centsDelta(440, 440, false)) < 1e-6);
check("+1 semitone (~466.16) → ~+100c", Math.abs(centsDelta(466.16, 440, false) - 100) < 0.5);
check("-1 semitone → ~-100c", Math.abs(centsDelta(415.30, 440, false) - -100) < 0.5);
check("octave up → 1200c", Math.abs(centsDelta(880, 440, false) - 1200) < 0.5);
check("octave down → -1200c", Math.abs(centsDelta(220, 440, false) - -1200) < 0.5);

console.log("\n[C] centsDelta octave-tolerant");
check("identical → 0c", Math.abs(centsDelta(440, 440, true)) < 1e-6);
check("octave up → 0c (folded)", Math.abs(centsDelta(880, 440, true)) < 0.5);
check("octave down → 0c (folded)", Math.abs(centsDelta(220, 440, true)) < 0.5);
check("two octaves up → 0c", Math.abs(centsDelta(1760, 440, true)) < 0.5);
check("+1 semitone → ~100c (still small)", Math.abs(centsDelta(466.16, 440, true) - 100) < 0.5);
check("+5 semitones → ~500c", Math.abs(centsDelta(587.33, 440, true) - 500) < 1);
check("+7 semitones → ~-500c (closer through octave)", Math.abs(centsDelta(659.26, 440, true) - -500) < 1);

console.log("\n[D] medianHz");
{
  const curve = {
    times: new Float32Array([0, 0.05, 0.10, 0.15]),
    hz: new Float32Array([200, 220, NaN, 240]),
    clarity: new Float32Array(4),
    hopSec: 0.05,
    fromSec: 0,
  };
  // Valid hz: [200, 220, 240], sorted, middle = 220
  check("median of [200, 220, NaN, 240] = 220", medianHz(curve) === 220);
}
{
  const curve = {
    times: new Float32Array([0, 0.05]),
    hz: new Float32Array([NaN, NaN]),
    clarity: new Float32Array(2),
    hopSec: 0.05,
    fromSec: 0,
  };
  check("all NaN → fallback 220", medianHz(curve) === 220);
}

console.log("\n[E] pitchAt linear interp");
{
  const curve = {
    times: new Float32Array([10.0, 10.05, 10.10]),
    hz: new Float32Array([200, 220, 240]),
    clarity: new Float32Array(3),
    hopSec: 0.05,
    fromSec: 10.0,
  };
  check("at sample boundary (10.0) → 200", Math.abs(pitchAt(curve, 10.0) - 200) < 1e-3);
  check("midway (10.025) → 210 (lerp)", Math.abs(pitchAt(curve, 10.025) - 210) < 1e-3);
  check("at second sample (10.05) → 220", Math.abs(pitchAt(curve, 10.05) - 220) < 1e-3);
  check("before fromSec → NaN", Number.isNaN(pitchAt(curve, 9.0)));
  check("after end → NaN", Number.isNaN(pitchAt(curve, 11.0)));
}
{
  const curve = {
    times: new Float32Array([10.0, 10.05, 10.10]),
    hz: new Float32Array([200, NaN, 240]),
    clarity: new Float32Array(3),
    hopSec: 0.05,
    fromSec: 10.0,
  };
  check("gap at hi → NaN", Number.isNaN(pitchAt(curve, 10.025)));
}

// ─── quantizeToNotes ────────────────────────────────────────────────
function medianFilter(arr, window = 5) {
  const out = new Float32Array(arr.length);
  const half = Math.floor(window / 2);
  const minValid = Math.ceil((window + 1) / 2);
  const tmp = [];
  for (let i = 0; i < arr.length; i++) {
    tmp.length = 0;
    for (let j = -half; j <= half; j++) {
      const k = i + j;
      if (k >= 0 && k < arr.length && Number.isFinite(arr[k])) tmp.push(arr[k]);
    }
    if (tmp.length < minValid) out[i] = NaN;
    else { tmp.sort((a, b) => a - b); out[i] = tmp[Math.floor(tmp.length / 2)]; }
  }
  return out;
}

function quantizeToNotes(curve, minDurSec = 0.08) {
  if (curve.hz.length === 0) return [];
  const smoothed = medianFilter(curve.hz, 5);
  const midiSeq = smoothed.length ? new Array(smoothed.length) : [];
  for (let i = 0; i < smoothed.length; i++) {
    const v = smoothed[i];
    midiSeq[i] = Number.isFinite(v) ? Math.round(hzToMidi(v)) : null;
  }
  const notes = [];
  let runStart = -1;
  let runMidi = null;
  for (let i = 0; i <= midiSeq.length; i++) {
    const cur = i < midiSeq.length ? midiSeq[i] : null;
    if (cur !== runMidi) {
      if (runMidi !== null && runStart >= 0) {
        const fromSec = curve.times[runStart];
        const lastIdx = Math.min(i - 1, curve.times.length - 1);
        const toSec = curve.times[lastIdx] + curve.hopSec;
        if (toSec - fromSec >= minDurSec) notes.push({ midi: runMidi, fromSec, toSec });
      }
      runMidi = cur;
      runStart = i;
    }
  }
  return notes;
}

console.log("\n[F] quantizeToNotes — single A4 note");
{
  // 10 frames of 440Hz — should yield one MIDI 69 note ~500ms long
  const curve = {
    times: new Float32Array(Array.from({ length: 10 }, (_, i) => i * 0.05)),
    hz: new Float32Array(10).fill(440),
    clarity: new Float32Array(10).fill(1),
    hopSec: 0.05,
    fromSec: 0,
  };
  const notes = quantizeToNotes(curve, 0.08);
  check("1 note produced", notes.length === 1);
  check("midi=69 (A4)", notes[0].midi === 69);
  check("duration ~500ms", Math.abs(notes[0].toSec - notes[0].fromSec - 0.5) < 1e-2);
}

console.log("\n[G] quantizeToNotes — single-frame glitch suppressed");
{
  // 9 frames @ 440 with one frame at 880 in middle — median filter should reject the glitch
  const hz = new Float32Array([440, 440, 440, 440, 880, 440, 440, 440, 440]);
  const curve = {
    times: new Float32Array(Array.from({ length: 9 }, (_, i) => i * 0.05)),
    hz,
    clarity: new Float32Array(9).fill(1),
    hopSec: 0.05,
    fromSec: 0,
  };
  const notes = quantizeToNotes(curve, 0.08);
  check("glitch absorbed → 1 note", notes.length === 1);
  check("note is A4", notes[0].midi === 69);
}

console.log("\n[H] quantizeToNotes — two distinct notes");
{
  // 5 frames A4, 5 frames A5
  const hz = new Float32Array([440, 440, 440, 440, 440, 880, 880, 880, 880, 880]);
  const curve = {
    times: new Float32Array(Array.from({ length: 10 }, (_, i) => i * 0.05)),
    hz,
    clarity: new Float32Array(10).fill(1),
    hopSec: 0.05,
    fromSec: 0,
  };
  const notes = quantizeToNotes(curve, 0.08);
  check("2 notes", notes.length === 2);
  check("first is A4", notes[0].midi === 69);
  check("second is A5", notes[1].midi === 81);
}

console.log("\n[I] quantizeToNotes — short note dropped");
{
  // 1-frame note (50ms < 80ms threshold)
  const hz = new Float32Array([NaN, NaN, 440, NaN, NaN]);
  const curve = {
    times: new Float32Array(Array.from({ length: 5 }, (_, i) => i * 0.05)),
    hz,
    clarity: new Float32Array(5).fill(1),
    hopSec: 0.05,
    fromSec: 0,
  };
  const notes = quantizeToNotes(curve, 0.08);
  check("transient dropped", notes.length === 0);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("\nall pitch checks passed");
}
