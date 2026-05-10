/**
 * Thin wrapper around @echogarden/rubberband-wasm. Offline mode: takes an
 * AudioBuffer slice, returns a new AudioBuffer with independent
 * time-stretching and pitch-shifting applied. Best for vocal-quality.
 *
 * Reasonably fast for short loops (~5–10× realtime on a modern laptop).
 * For 5 sec × 6 stems expect ~3–6 s wall clock — debounce control changes
 * to avoid running the stretcher on every keystroke.
 */

// rubberband C-API options (from rubberband-c.h).
const OPT_PROCESS_OFFLINE = 0x00000000;
const OPT_TRANSIENTS_MIXED = 0x00000100;
const OPT_THREADING_NEVER = 0x00010000;
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

interface RBModule {
  HEAPF32: Float32Array;
  HEAPU32: Uint32Array;
  _malloc(n: number): number;
  _free(ptr: number): void;
  _rubberband_new(
    sampleRate: number,
    channels: number,
    options: number,
    initialTimeRatio: number,
    initialPitchScale: number,
  ): number;
  _rubberband_delete(stretcher: number): void;
  _rubberband_set_time_ratio(stretcher: number, ratio: number): void;
  _rubberband_set_pitch_scale(stretcher: number, scale: number): void;
  _rubberband_set_expected_input_duration(stretcher: number, samples: number): void;
  _rubberband_study(stretcher: number, planesPtr: number, samples: number, isFinal: number): void;
  _rubberband_process(stretcher: number, planesPtr: number, samples: number, isFinal: number): void;
  _rubberband_available(stretcher: number): number;
  _rubberband_retrieve(stretcher: number, planesPtr: number, samples: number): number;
}

let modulePromise: Promise<RBModule> | null = null;

async function getModule(): Promise<RBModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const RubberbandFactory = (
        await import(/* webpackIgnore: true */ "@echogarden/rubberband-wasm")
      ).default as (opts: { locateFile: (p: string) => string }) => Promise<RBModule>;
      return RubberbandFactory({
        locateFile: (path: string) => (path.endsWith(".wasm") ? "/rubberband.wasm" : path),
      });
    })();
  }
  return modulePromise;
}

/** Convert semitones to a pitch scale ratio. */
export function semitonesToScale(semi: number): number {
  return Math.pow(2, semi / 12);
}

/** Whether a (timeRatio, pitchScale) pair is effectively the identity. */
export function isPassthrough(timeRatio: number, pitchScale: number): boolean {
  return Math.abs(timeRatio - 1) < 1e-4 && Math.abs(pitchScale - 1) < 1e-4;
}

/**
 * Time-stretch and/or pitch-shift `[fromSec, toSec]` of `src`.
 *
 * @param timeRatio  output_duration / input_duration (so 1.43 plays slower)
 * @param pitchScale 1.0 = unchanged. Use semitonesToScale(N) for N semitones.
 */
export async function stretchAudioBuffer(
  ctx: BaseAudioContext,
  src: AudioBuffer,
  fromSec: number,
  toSec: number,
  timeRatio: number,
  pitchScale: number,
): Promise<AudioBuffer> {
  const M = await getModule();
  const sr = src.sampleRate;
  const channels = src.numberOfChannels;
  const startSample = Math.max(0, Math.floor(fromSec * sr));
  const endSample = Math.min(src.length, Math.floor(toSec * sr));
  const inputLen = Math.max(0, endSample - startSample);

  if (inputLen === 0) {
    return ctx.createBuffer(channels, 1, sr);
  }

  const F32 = 4;
  const PTR = 4;

  // Build with identity ratios; apply real values via setters. Construction-
  // time arguments behave inconsistently in this wasm binding.
  const stretcher = M._rubberband_new(sr, channels, VOCAL_OPTS, 1.0, 1.0);
  M._rubberband_set_time_ratio(stretcher, timeRatio);
  M._rubberband_set_pitch_scale(stretcher, pitchScale);

  // One pass: allocate the whole input region in wasm heap.
  const inputBufPtr = M._malloc(channels * inputLen * F32);
  const inputPlanesPtr = M._malloc(channels * PTR);
  for (let c = 0; c < channels; c++) {
    const data = src.getChannelData(c).subarray(startSample, endSample);
    const planePtr = inputBufPtr + c * inputLen * F32;
    M.HEAPF32.set(data, planePtr / F32);
    M.HEAPU32[(inputPlanesPtr / PTR) + c] = planePtr;
  }
  // Offline mode requires study(all-input) before process(all-input).
  M._rubberband_set_expected_input_duration(stretcher, inputLen);
  M._rubberband_study(stretcher, inputPlanesPtr, inputLen, 1);
  M._rubberband_process(stretcher, inputPlanesPtr, inputLen, 1);

  // Drain output in chunks of `tmpLen` samples.
  const tmpLen = 8192;
  const tmpBufPtr = M._malloc(channels * tmpLen * F32);
  const tmpPlanesPtr = M._malloc(channels * PTR);
  for (let c = 0; c < channels; c++) {
    M.HEAPU32[(tmpPlanesPtr / PTR) + c] = tmpBufPtr + c * tmpLen * F32;
  }

  const outChannels: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(0));
  while (true) {
    const avail = M._rubberband_available(stretcher);
    if (avail < 0) break; // -1 → no more output
    if (avail === 0) break;
    const want = Math.min(avail, tmpLen);
    const got = M._rubberband_retrieve(stretcher, tmpPlanesPtr, want);
    if (got <= 0) break;
    for (let c = 0; c < channels; c++) {
      const planePtr = tmpBufPtr + c * tmpLen * F32;
      const chunk = M.HEAPF32.slice(planePtr / F32, planePtr / F32 + got);
      const merged = new Float32Array(outChannels[c].length + got);
      merged.set(outChannels[c]);
      merged.set(chunk, outChannels[c].length);
      outChannels[c] = merged;
    }
  }

  const outBuf = ctx.createBuffer(channels, Math.max(1, outChannels[0].length), sr);
  for (let c = 0; c < channels; c++) {
    if (outChannels[c].length > 0) {
      // Explicit ArrayBuffer-backed copy for stricter Float32Array<ArrayBuffer> checks.
      const copy = new Float32Array(new ArrayBuffer(outChannels[c].byteLength));
      copy.set(outChannels[c]);
      outBuf.copyToChannel(copy, c);
    }
  }

  M._free(inputBufPtr);
  M._free(inputPlanesPtr);
  M._free(tmpBufPtr);
  M._free(tmpPlanesPtr);
  M._rubberband_delete(stretcher);

  return outBuf;
}
