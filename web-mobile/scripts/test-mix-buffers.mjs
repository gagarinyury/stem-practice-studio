#!/usr/bin/env node
/**
 * Tests for mixAudioBuffers — sums N stems sample-wise into one buffer.
 * Reproduces the function from audio-engine.ts so it can run in pure node
 * without DOM. The real implementation uses ctx.createBuffer; here we
 * mock that with plain Float32Array data.
 *
 *   node scripts/test-mix-buffers.mjs
 */

let failures = 0;
function check(label, cond, info = "") {
  const tag = cond ? "✓" : "✗";
  console.log(`  ${tag} ${label}${info ? "  " + info : ""}`);
  if (!cond) failures++;
}

/** Mock AudioBuffer-shape using Float32Array per channel. */
function buf(channels, length, sampleRate, fillFn) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  if (fillFn) {
    for (let c = 0; c < channels; c++) for (let i = 0; i < length; i++) data[c][i] = fillFn(c, i);
  }
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    getChannelData: (c) => data[c],
  };
}

function mockCtx() {
  return {
    createBuffer: (channels, length, sampleRate) => buf(channels, length, sampleRate),
  };
}

function mixAudioBuffers(ctx, buffers) {
  if (buffers.length === 0) throw new Error("mixAudioBuffers: empty input");
  const sampleRate = buffers[0].sampleRate;
  const channels = Math.max(...buffers.map((b) => b.numberOfChannels));
  const length = Math.max(...buffers.map((b) => b.length));
  const out = ctx.createBuffer(channels, length, sampleRate);
  for (let c = 0; c < channels; c++) {
    const dst = out.getChannelData(c);
    for (const b of buffers) {
      const srcCh = b.numberOfChannels > c ? b.getChannelData(c) : b.getChannelData(0);
      const n = Math.min(dst.length, srcCh.length);
      for (let i = 0; i < n; i++) dst[i] += srcCh[i];
    }
  }
  return out;
}

const ctx = mockCtx();

console.log("[A] sum two mono buffers");
{
  const a = buf(1, 4, 48000, (_c, i) => i * 0.1);   // [0, 0.1, 0.2, 0.3]
  const b = buf(1, 4, 48000, (_c, i) => i * 0.2);   // [0, 0.2, 0.4, 0.6]
  const m = mixAudioBuffers(ctx, [a, b]);
  const ch = m.getChannelData(0);
  check("length=4", ch.length === 4);
  check("[0]=0", Math.abs(ch[0] - 0) < 1e-6, `got ${ch[0]}`);
  check("[1]=0.3", Math.abs(ch[1] - 0.3) < 1e-6, `got ${ch[1]}`);
  check("[2]=0.6", Math.abs(ch[2] - 0.6) < 1e-6, `got ${ch[2]}`);
  check("[3]=0.9", Math.abs(ch[3] - 0.9) < 1e-6, `got ${ch[3]}`);
}

console.log("\n[B] mix differs in length — output uses max length");
{
  const a = buf(1, 3, 48000, () => 0.5); // 3 samples of 0.5
  const b = buf(1, 5, 48000, () => 0.1); // 5 samples of 0.1
  const m = mixAudioBuffers(ctx, [a, b]);
  const ch = m.getChannelData(0);
  check("length=5 (max)", ch.length === 5);
  check("[0]=0.6", Math.abs(ch[0] - 0.6) < 1e-6, `got ${ch[0]}`);
  check("[2]=0.6 (last where both contribute)", Math.abs(ch[2] - 0.6) < 1e-6, `got ${ch[2]}`);
  check("[3]=0.1 (only b)", Math.abs(ch[3] - 0.1) < 1e-6, `got ${ch[3]}`);
  check("[4]=0.1 (only b)", Math.abs(ch[4] - 0.1) < 1e-6, `got ${ch[4]}`);
}

console.log("\n[C] stereo + mono mix — mono fans out to all channels");
{
  const stereo = buf(2, 3, 48000, (c) => (c === 0 ? 1 : 2)); // L=1, R=2
  const mono = buf(1, 3, 48000, () => 0.5);
  const m = mixAudioBuffers(ctx, [stereo, mono]);
  check("output channels=2", m.numberOfChannels === 2);
  const L = m.getChannelData(0);
  const R = m.getChannelData(1);
  check("L[0]=1.5 (stereo L + mono)", Math.abs(L[0] - 1.5) < 1e-6, `got ${L[0]}`);
  check("R[0]=2.5 (stereo R + mono)", Math.abs(R[0] - 2.5) < 1e-6, `got ${R[0]}`);
}

console.log("\n[D] simulate drill case — 5 non-vocal stems @ 0.2 each");
{
  const stems = Array.from({ length: 5 }, () => buf(2, 100, 44100, () => 0.2));
  const m = mixAudioBuffers(ctx, stems);
  const L = m.getChannelData(0);
  check("each sample = 1.0 (5 × 0.2)", Math.abs(L[50] - 1.0) < 1e-6, `got ${L[50]}`);
  check("output channels=2", m.numberOfChannels === 2);
  check("output length=100", m.length === 100);
}

console.log("\n[E] empty input throws");
{
  let threw = false;
  try { mixAudioBuffers(ctx, []); } catch { threw = true; }
  check("throws on empty", threw);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("\nall mix-buffers checks passed");
}
