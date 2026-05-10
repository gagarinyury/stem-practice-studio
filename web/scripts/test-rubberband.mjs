#!/usr/bin/env node
/**
 * Smoke-test rubberband-wasm directly in Node.
 *
 *   node scripts/test-rubberband.mjs
 *
 * Builds a 2-second mono sine at 440 Hz, runs it through rubberband twice:
 *   (a) timeRatio=1.5, pitchScale=1   → should be ~3 sec, still 440 Hz
 *   (b) timeRatio=1.0, pitchScale=1.5 → should still be ~2 sec, ~660 Hz
 *
 * Frequency is detected via zero-crossing rate over a stable window — good
 * enough to verify pitch is shifting in the right direction.
 */
import RubberbandFactory from "@echogarden/rubberband-wasm";

const SR = 44100;
const DUR_SEC = 2.0;
const BASE_HZ = 440;

// rubberband C-API flags (from rubberband-c.h)
const OPT_PROCESS_OFFLINE = 0x00000000;
const OPT_TRANSIENTS_MIXED = 0x00000100;
const OPT_THREADING_NEVER = 0x00010000;   // was wrong (0x20) before
const OPT_FORMANT_PRESERVED = 0x01000000;
const OPT_PITCH_HIGH_QUALITY = 0x02000000;
const OPT_CHANNELS_TOGETHER = 0x10000000;
const VOCAL_OPTS =
  OPT_PROCESS_OFFLINE |
  OPT_TRANSIENTS_MIXED |
  OPT_THREADING_NEVER |
  OPT_FORMANT_PRESERVED |
  OPT_PITCH_HIGH_QUALITY |
  OPT_CHANNELS_TOGETHER;

function makeSine(durSec, hz) {
  const len = Math.floor(durSec * SR);
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    data[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SR);
  }
  return data;
}

/** Estimate dominant frequency by counting zero crossings in the middle 1s window. */
function freqFromZeroCrossings(samples) {
  const n = samples.length;
  const winStart = Math.floor(n * 0.25);
  const winEnd = Math.floor(n * 0.75);
  const winLen = winEnd - winStart;
  if (winLen < 1000) return 0;
  let crossings = 0;
  for (let i = winStart + 1; i < winEnd; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
  }
  const winSec = winLen / SR;
  return crossings / winSec;
}

async function stretch(input, timeRatio, pitchScale) {
  const M = await RubberbandFactory({});
  const channels = 1;
  const inputLen = input.length;
  const F32 = 4;
  const PTR = 4;

  // Pass identity ratios at construction; apply real values via explicit
  // setters before processing. Construction-time ratios appear to be
  // interpreted in unexpected ways by the WASM binding.
  const stretcher = M._rubberband_new(SR, channels, VOCAL_OPTS, 1.0, 1.0);
  M._rubberband_set_time_ratio(stretcher, timeRatio);
  M._rubberband_set_pitch_scale(stretcher, pitchScale);

  const inBuf = M._malloc(inputLen * F32);
  const inPlanes = M._malloc(channels * PTR);
  M.HEAPF32.set(input, inBuf / F32);
  M.HEAPU32[inPlanes / PTR] = inBuf;

  // Offline mode requires study() of the entire input before process().
  M._rubberband_set_expected_input_duration?.(stretcher, inputLen);
  M._rubberband_study(stretcher, inPlanes, inputLen, 1);
  M._rubberband_process(stretcher, inPlanes, inputLen, 1);

  const tmpLen = 8192;
  const tmpBuf = M._malloc(tmpLen * F32);
  const tmpPlanes = M._malloc(channels * PTR);
  M.HEAPU32[tmpPlanes / PTR] = tmpBuf;

  let out = new Float32Array(0);
  while (true) {
    const avail = M._rubberband_available(stretcher);
    if (avail <= 0) break;
    const want = Math.min(avail, tmpLen);
    const got = M._rubberband_retrieve(stretcher, tmpPlanes, want);
    if (got <= 0) break;
    const chunk = M.HEAPF32.slice(tmpBuf / F32, tmpBuf / F32 + got);
    const merged = new Float32Array(out.length + got);
    merged.set(out);
    merged.set(chunk, out.length);
    out = merged;
  }

  M._free(inBuf);
  M._free(inPlanes);
  M._free(tmpBuf);
  M._free(tmpPlanes);
  M._rubberband_delete(stretcher);
  return out;
}

let failures = 0;
function check(label, cond, info = "") {
  const tag = cond ? "✓" : "✗";
  console.log(`  ${tag} ${label}${info ? "  " + info : ""}`);
  if (!cond) failures++;
}

const input = makeSine(DUR_SEC, BASE_HZ);
const inputHz = freqFromZeroCrossings(input);
console.log(`input: ${input.length} samples (${(input.length / SR).toFixed(2)}s), detected ${inputHz.toFixed(1)} Hz`);
check("input frequency ≈ 440 Hz", Math.abs(inputHz - BASE_HZ) < 5, `(got ${inputHz.toFixed(1)})`);

console.log("\n[A] timeRatio=1.5, pitchScale=1.0 (slow down, same pitch)");
const a = await stretch(input, 1.5, 1.0);
const aDurSec = a.length / SR;
const aHz = freqFromZeroCrossings(a);
console.log(`  output: ${a.length} samples (${aDurSec.toFixed(2)}s), detected ${aHz.toFixed(1)} Hz`);
check("output ~ 1.5× longer", Math.abs(aDurSec - DUR_SEC * 1.5) < 0.15, `(${aDurSec.toFixed(2)}s vs expected 3.00s)`);
check("pitch unchanged ~ 440 Hz", Math.abs(aHz - BASE_HZ) < 15, `(got ${aHz.toFixed(1)})`);

console.log("\n[B] timeRatio=1.0, pitchScale=1.5 (same speed, pitch up ~7 semitones)");
const b = await stretch(input, 1.0, 1.5);
const bDurSec = b.length / SR;
const bHz = freqFromZeroCrossings(b);
const expectedB = BASE_HZ * 1.5;
console.log(`  output: ${b.length} samples (${bDurSec.toFixed(2)}s), detected ${bHz.toFixed(1)} Hz`);
check("duration unchanged ~ 2 s", Math.abs(bDurSec - DUR_SEC) < 0.15, `(${bDurSec.toFixed(2)}s)`);
check("pitch ~ 660 Hz", Math.abs(bHz - expectedB) < 25, `(got ${bHz.toFixed(1)} vs expected ${expectedB})`);

console.log("\n[C] timeRatio=0.7, pitchScale=Math.pow(2, -2/12) (faster, lower 2 semi)");
const cRatio = 0.7;
const cScale = Math.pow(2, -2 / 12);
const c = await stretch(input, cRatio, cScale);
const cDurSec = c.length / SR;
const cHz = freqFromZeroCrossings(c);
const expectedC = BASE_HZ * cScale;
console.log(`  output: ${c.length} samples (${cDurSec.toFixed(2)}s), detected ${cHz.toFixed(1)} Hz`);
check("output ~ 0.7× longer (faster)", Math.abs(cDurSec - DUR_SEC * cRatio) < 0.15, `(${cDurSec.toFixed(2)}s)`);
check(`pitch ~ ${expectedC.toFixed(1)} Hz (-2 semi)`, Math.abs(cHz - expectedC) < 25, `(got ${cHz.toFixed(1)})`);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("\nall checks passed");
}
