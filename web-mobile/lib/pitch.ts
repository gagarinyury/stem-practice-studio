/**
 * Pitch detection helpers built on `pitchy` (MPM autocorrelation).
 *
 * Two flavors:
 *  - `detectPitchOffline`: process a slice of an AudioBuffer (the vocal stem
 *    after demucs) into a sparse {times, hz, clarity} curve. Used once per
 *    drill chunk to render the target ribbon.
 *  - `createMicTracker`: tap a live MediaStream into an AnalyserNode and
 *    expose a `read()` returning the current pitch. The caller polls from
 *    its existing RAF loop so we don't spawn another timer.
 */

import { PitchDetector } from "pitchy";

export interface PitchCurve {
  /** seconds, monotonically increasing, hop-aligned */
  times: Float32Array;
  /** detected fundamental, NaN where undetected */
  hz: Float32Array;
  /** pitchy clarity 0..1 */
  clarity: Float32Array;
  /** sampling hop in seconds */
  hopSec: number;
  /** absolute start of the curve in track time */
  fromSec: number;
}

const DEFAULT_HOP = 0.05;
const FRAME_SIZE = 2048;

/** Hz range we consider plausible singing. Outside → reject sample. */
const MIN_HZ = 65;
const MAX_HZ = 1200;
const MIN_CLARITY = 0.85;

/**
 * Detect pitch over a slice of an AudioBuffer. Mixes channels to mono,
 * windows in `frameSize` samples (default 2048 ≈ 46ms @ 44.1k) every
 * `hopSec` seconds. Samples with low clarity or out-of-range hz are
 * stored as NaN so callers can render gaps.
 */
export function detectPitchOffline(
  buffer: AudioBuffer,
  fromSec: number,
  toSec: number,
  hopSec: number = DEFAULT_HOP,
  frameSize: number = FRAME_SIZE,
): PitchCurve {
  const sr = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(fromSec * sr));
  const endSample = Math.min(buffer.length, Math.floor(toSec * sr));
  const totalSamples = Math.max(0, endSample - startSample);
  if (totalSamples < frameSize) {
    return {
      times: new Float32Array(0),
      hz: new Float32Array(0),
      clarity: new Float32Array(0),
      hopSec,
      fromSec,
    };
  }

  // Down-mix to a single Float32Array slice.
  const ch0 = buffer.getChannelData(0);
  const ch1 =
    buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const mono = new Float32Array(totalSamples);
  if (ch1) {
    for (let i = 0; i < totalSamples; i++) {
      mono[i] = (ch0[startSample + i] + ch1[startSample + i]) * 0.5;
    }
  } else {
    mono.set(ch0.subarray(startSample, endSample));
  }

  const hopSamples = Math.max(1, Math.round(hopSec * sr));
  const detector = PitchDetector.forFloat32Array(frameSize);
  const numFrames = Math.max(0, Math.floor((mono.length - frameSize) / hopSamples) + 1);

  const times = new Float32Array(numFrames);
  const hz = new Float32Array(numFrames);
  const clarity = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const off = f * hopSamples;
    const window = mono.subarray(off, off + frameSize);
    const [pitch, clar] = detector.findPitch(window, sr);
    times[f] = fromSec + (off + frameSize / 2) / sr;
    if (clar < MIN_CLARITY || pitch < MIN_HZ || pitch > MAX_HZ || !Number.isFinite(pitch)) {
      hz[f] = NaN;
      clarity[f] = clar;
    } else {
      hz[f] = pitch;
      clarity[f] = clar;
    }
  }

  return { times, hz, clarity, hopSec, fromSec };
}

/**
 * Live pitch tracker for a microphone (or any) stream. Connects the
 * stream into an `AnalyserNode` on the given AudioContext; caller polls
 * `read()` from RAF to get the latest pitch. Returns `null` until the
 * analyser has at least one full frame buffered.
 */
export interface MicTracker {
  read(): { hz: number; clarity: number } | null;
  dispose(): void;
}

export function createMicTracker(ctx: BaseAudioContext, stream: MediaStream): MicTracker {
  const src = (ctx as AudioContext).createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FRAME_SIZE;
  analyser.smoothingTimeConstant = 0.0;
  src.connect(analyser);

  const detector = PitchDetector.forFloat32Array(analyser.fftSize);
  const buf = new Float32Array(analyser.fftSize);

  return {
    read() {
      analyser.getFloatTimeDomainData(buf);
      const [pitch, clar] = detector.findPitch(buf, ctx.sampleRate);
      if (clar < MIN_CLARITY || pitch < MIN_HZ || pitch > MAX_HZ || !Number.isFinite(pitch)) {
        return { hz: NaN, clarity: clar };
      }
      return { hz: pitch, clarity: clar };
    },
    dispose() {
      try { src.disconnect(); } catch { /* noop */ }
      try { analyser.disconnect(); } catch { /* noop */ }
    },
  };
}

/** Convert hz to MIDI note number (float). */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/**
 * Cents difference between two pitches, octave-tolerant by default —
 * folds to nearest octave so a mic at 110Hz vs vocal at 220Hz still
 * reads ~0 cents apart.
 */
export function centsDelta(yourHz: number, targetHz: number, octaveTolerant = true): number {
  if (!isFinite(yourHz) || !isFinite(targetHz) || yourHz <= 0 || targetHz <= 0) return Infinity;
  let cents = 1200 * Math.log2(yourHz / targetHz);
  if (octaveTolerant) {
    // Wrap to (-600, 600] — closest octave fold
    cents = ((cents + 600) % 1200 + 1200) % 1200 - 600;
  }
  return cents;
}

/** Median pitch (in Hz) of a curve — used as ribbon Y-axis center. */
export function medianHz(curve: PitchCurve): number {
  const valid: number[] = [];
  for (let i = 0; i < curve.hz.length; i++) {
    if (Number.isFinite(curve.hz[i])) valid.push(curve.hz[i]);
  }
  if (valid.length === 0) return 220;
  valid.sort((a, b) => a - b);
  return valid[Math.floor(valid.length / 2)];
}

/**
 * Linearly interpolate pitch curve at given time. Returns NaN if the
 * surrounding samples are gaps.
 */
export function pitchAt(curve: PitchCurve, t: number): number {
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

export interface Note {
  /** MIDI note (integer). */
  midi: number;
  /** Track-time start. */
  fromSec: number;
  /** Track-time end (exclusive). */
  toSec: number;
}

/**
 * Quantize a raw pitch curve into "note blobs" — the visual unit for
 * piano-roll rendering. The goal is the look of a piano transcription:
 * a few clean rectangles per phrase rather than every wiggle of a
 * sliding human voice.
 *
 * Pipeline:
 *  1. Median filter (window 7) — kills single-frame glitches and
 *     vibrato wobble
 *  2. Snap each finite frame to the nearest MIDI semitone
 *  3. Merge consecutive equal-MIDI frames into raw note runs
 *  4. Drop transients shorter than `minDurSec` (150ms by default)
 *  5. Sandwich pass — if a short note is wedged between two longer
 *     notes of the same MIDI within `bridgeSec`, remove the wedge
 *     and merge its neighbors. Catches passing tones / scoops
 *  6. Bridge same-MIDI notes separated by gaps under `bridgeSec`
 */
export function quantizeToNotes(
  curve: PitchCurve,
  minDurSec = 0.15,
  bridgeSec = 0.18,
): Note[] {
  if (curve.hz.length === 0) return [];
  const smoothed = medianFilter(curve.hz, 7);
  const midiSeq = new Array<number | null>(smoothed.length);
  for (let i = 0; i < smoothed.length; i++) {
    const v = smoothed[i];
    midiSeq[i] = Number.isFinite(v) ? Math.round(hzToMidi(v)) : null;
  }

  // Build raw runs (no length filter yet — we need shorts for the sandwich pass)
  const raw: Note[] = [];
  let runStart = -1;
  let runMidi: number | null = null;
  for (let i = 0; i <= midiSeq.length; i++) {
    const cur = i < midiSeq.length ? midiSeq[i] : null;
    if (cur !== runMidi) {
      if (runMidi !== null && runStart >= 0) {
        const fromSec = curve.times[runStart];
        const lastIdx = Math.min(i - 1, curve.times.length - 1);
        const toSec = curve.times[lastIdx] + curve.hopSec;
        raw.push({ midi: runMidi, fromSec, toSec });
      }
      runMidi = cur;
      runStart = i;
    }
  }

  // Sandwich pass: short note between two longer same-MIDI neighbors → drop & merge.
  let pass: Note[] = raw;
  for (let iter = 0; iter < 2; iter++) {
    const next: Note[] = [];
    for (let i = 0; i < pass.length; i++) {
      const cur = pass[i];
      const prev = next[next.length - 1];
      const after = pass[i + 1];
      const dur = cur.toSec - cur.fromSec;
      if (
        prev &&
        after &&
        dur < minDurSec &&
        prev.midi === after.midi &&
        cur.midi !== prev.midi &&
        after.fromSec - prev.toSec <= bridgeSec * 2
      ) {
        // Drop cur, extend prev to cover after
        prev.toSec = after.toSec;
        i++; // skip after, it's now folded into prev
        continue;
      }
      next.push({ ...cur });
    }
    pass = next;
  }

  // Bridge same-MIDI notes separated by short gaps.
  const bridged: Note[] = [];
  for (const n of pass) {
    const prev = bridged[bridged.length - 1];
    if (prev && prev.midi === n.midi && n.fromSec - prev.toSec <= bridgeSec) {
      prev.toSec = n.toSec;
    } else {
      bridged.push({ ...n });
    }
  }

  // Final length filter.
  return bridged.filter((n) => n.toSec - n.fromSec >= minDurSec);
}

function medianFilter(arr: Float32Array, window = 5): Float32Array {
  const out = new Float32Array(arr.length);
  const half = Math.floor(window / 2);
  // Require at least majority-of-window valid samples — otherwise output
  // NaN. This prevents a single-frame value from being smeared across an
  // otherwise-silent neighborhood.
  const minValid = Math.ceil((window + 1) / 2);
  const tmp: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    tmp.length = 0;
    for (let j = -half; j <= half; j++) {
      const k = i + j;
      if (k >= 0 && k < arr.length && Number.isFinite(arr[k])) tmp.push(arr[k]);
    }
    if (tmp.length < minValid) {
      out[i] = NaN;
    } else {
      tmp.sort((a, b) => a - b);
      out[i] = tmp[Math.floor(tmp.length / 2)];
    }
  }
  return out;
}
