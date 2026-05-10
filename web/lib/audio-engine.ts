export interface StemSpec {
  key: string;
  url: string;
}

interface StemNode {
  key: string;
  /** Original full-length stem buffer. */
  buffer: AudioBuffer;
  /** Buffer currently bound to `source`. May be the original or a stretched slice. */
  activeBuffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  muted: boolean;
}

export type EngineState = "idle" | "loading" | "ready" | "playing" | "paused";

export interface Spectrum {
  left: Float32Array;
  right: Float32Array;
  peakL: Float32Array;
  peakR: Float32Array;
}

export class StemEngine {
  private ctx: AudioContext | null = null;
  private stems: StemNode[] = [];
  private mix: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuf: Float32Array<ArrayBuffer> | null = null;
  private fftL: AnalyserNode | null = null;
  private fftR: AnalyserNode | null = null;
  private fftBufL: Uint8Array<ArrayBuffer> | null = null;
  private fftBufR: Uint8Array<ArrayBuffer> | null = null;
  private barLvlL: Float32Array | null = null;
  private barLvlR: Float32Array | null = null;
  private peakHoldL: Float32Array | null = null;
  private peakHoldR: Float32Array | null = null;
  private smoothLevel = 0;
  private startCtxTime = 0;
  private startOffset = 0;
  private duration = 0;
  private loopRange: { from: number; to: number } | null = null;
  private rate = 1.0;
  /** Set when active buffers are rubberband-stretched slices. */
  private stretchInfo: {
    timeRatio: number;
    pitchScale: number;
    loop: { from: number; to: number };
  } | null = null;
  state: EngineState = "idle";
  onStateChange?: (s: EngineState) => void;

  async load(specs: StemSpec[]): Promise<void> {
    this.setState("loading");
    if (!this.ctx) this.ctx = new AudioContext();
    const ctx = this.ctx;

    this.mix = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyserBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    this.mix.connect(this.analyser);

    const splitter = ctx.createChannelSplitter(2);
    this.fftL = ctx.createAnalyser();
    this.fftR = ctx.createAnalyser();
    this.fftL.fftSize = 2048;
    this.fftR.fftSize = 2048;
    this.fftL.smoothingTimeConstant = 0.35;
    this.fftR.smoothingTimeConstant = 0.35;
    this.fftBufL = new Uint8Array(new ArrayBuffer(this.fftL.frequencyBinCount));
    this.fftBufR = new Uint8Array(new ArrayBuffer(this.fftR.frequencyBinCount));
    this.mix.connect(splitter);
    splitter.connect(this.fftL, 0);
    splitter.connect(this.fftR, 1);

    this.mix.connect(ctx.destination);

    const fetched = await Promise.all(
      specs.map(async (s) => {
        const res = await fetch(s.url);
        const arr = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arr);
        return { key: s.key, buffer };
      })
    );

    this.stems = fetched.map(({ key, buffer }) => {
      const gain = ctx.createGain();
      gain.connect(this.mix!);
      return { key, buffer, activeBuffer: buffer, source: null, gain, muted: false };
    });
    this.duration = Math.max(...this.stems.map((s) => s.buffer.duration));
    this.setState("ready");
  }

  private rmsBuckets(channels: Float32Array[], buckets: number, totalSamples: number): Float32Array {
    const out = new Float32Array(buckets);
    const samplesPerBucket = Math.max(1, Math.floor(totalSamples / buckets));
    for (let b = 0; b < buckets; b++) {
      const start = b * samplesPerBucket;
      const end = Math.min(start + samplesPerBucket, totalSamples);
      let sum = 0;
      for (let i = start; i < end; i++) {
        let mix = 0;
        for (const ch of channels) if (i < ch.length) mix += ch[i];
        sum += mix * mix;
      }
      out[b] = Math.sqrt(sum / Math.max(1, end - start));
    }
    return out;
  }

  private normalizePercentile(arr: Float32Array, percentile = 0.78, gamma = 0.59): void {
    const sorted = Array.from(arr).filter((v) => v > 0).sort((a, b) => a - b);
    if (sorted.length === 0) return;
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
    const ref = sorted[idx] || sorted[sorted.length - 1] || 1;
    for (let i = 0; i < arr.length; i++) {
      const n = Math.min(1, arr[i] / ref);
      arr[i] = Math.pow(n, gamma);
    }
  }

  /** Stereo peaks: left channel up, right channel down. Sums all stems per channel. */
  getPeaks(buckets: number): { left: Float32Array; right: Float32Array } {
    if (this.stems.length === 0) {
      return { left: new Float32Array(buckets), right: new Float32Array(buckets) };
    }
    const sampleRate = this.stems[0].buffer.sampleRate;
    const totalSamples = Math.floor(this.duration * sampleRate);
    const leftCh: Float32Array[] = [];
    const rightCh: Float32Array[] = [];
    for (const s of this.stems) {
      leftCh.push(s.buffer.getChannelData(0));
      rightCh.push(s.buffer.numberOfChannels > 1 ? s.buffer.getChannelData(1) : s.buffer.getChannelData(0));
    }
    const left = this.rmsBuckets(leftCh, buckets, totalSamples);
    const right = this.rmsBuckets(rightCh, buckets, totalSamples);
    // Normalize jointly so L/R retain their relative differences
    const joint = new Float32Array(buckets * 2);
    joint.set(left, 0);
    joint.set(right, buckets);
    this.normalizePercentile(joint);
    left.set(joint.subarray(0, buckets));
    right.set(joint.subarray(buckets));
    return { left, right };
  }

  /** Mixed L/R peaks for a time slice [fromSec, toSec]. Same normalization as getPeaks. */
  getPeaksRange(
    buckets: number,
    fromSec: number,
    toSec: number,
  ): { left: Float32Array; right: Float32Array } {
    if (this.stems.length === 0 || toSec <= fromSec) {
      return { left: new Float32Array(buckets), right: new Float32Array(buckets) };
    }
    const sampleRate = this.stems[0].buffer.sampleRate;
    const startSample = Math.max(0, Math.floor(fromSec * sampleRate));
    const endSample = Math.min(
      Math.floor(this.duration * sampleRate),
      Math.floor(toSec * sampleRate),
    );
    const span = endSample - startSample;
    const leftCh: Float32Array[] = [];
    const rightCh: Float32Array[] = [];
    for (const s of this.stems) {
      leftCh.push(s.buffer.getChannelData(0).subarray(startSample, endSample));
      rightCh.push(
        (s.buffer.numberOfChannels > 1 ? s.buffer.getChannelData(1) : s.buffer.getChannelData(0))
          .subarray(startSample, endSample),
      );
    }
    const left = this.rmsBuckets(leftCh, buckets, span);
    const right = this.rmsBuckets(rightCh, buckets, span);
    const joint = new Float32Array(buckets * 2);
    joint.set(left, 0);
    joint.set(right, buckets);
    this.normalizePercentile(joint);
    left.set(joint.subarray(0, buckets));
    right.set(joint.subarray(buckets));
    return { left, right };
  }

  /** Per-stem L/R peaks. */
  getStemPeaks(buckets: number): Record<string, { left: Float32Array; right: Float32Array }> {
    const result: Record<string, { left: Float32Array; right: Float32Array }> = {};
    if (this.stems.length === 0) return result;
    const sampleRate = this.stems[0].buffer.sampleRate;
    const totalSamples = Math.floor(this.duration * sampleRate);
    for (const stem of this.stems) {
      const L = [stem.buffer.getChannelData(0)];
      const R = [stem.buffer.numberOfChannels > 1 ? stem.buffer.getChannelData(1) : stem.buffer.getChannelData(0)];
      const left = this.rmsBuckets(L, buckets, totalSamples);
      const right = this.rmsBuckets(R, buckets, totalSamples);
      const joint = new Float32Array(buckets * 2);
      joint.set(left, 0);
      joint.set(right, buckets);
      this.normalizePercentile(joint);
      left.set(joint.subarray(0, buckets));
      right.set(joint.subarray(buckets));
      result[stem.key] = { left, right };
    }
    return result;
  }

  /** Tick the live FFT spectrum. Call every animation frame. */
  tickSpectrum(buckets: number, pinkExp = 0.42): Spectrum {
    if (!this.barLvlL || this.barLvlL.length !== buckets) {
      this.barLvlL = new Float32Array(buckets);
      this.barLvlR = new Float32Array(buckets);
      this.peakHoldL = new Float32Array(buckets);
      this.peakHoldR = new Float32Array(buckets);
    }
    const isPlaying = this.state === "playing" && this.fftL && this.fftR && this.fftBufL && this.fftBufR;
    if (isPlaying) {
      this.fftL!.getByteFrequencyData(this.fftBufL!);
      this.fftR!.getByteFrequencyData(this.fftBufR!);
    }
    const N = this.fftBufL?.length ?? 0;
    const logMin = Math.log(2);
    const logMax = Math.log(Math.max(N - 1, 3));
    for (let b = 0; b < buckets; b++) {
      const t0 = b / buckets;
      const t1 = (b + 1) / buckets;
      const i0 = Math.max(1, Math.floor(Math.exp(logMin + (logMax - logMin) * t0)));
      const i1 = Math.min(N, Math.max(i0 + 1, Math.floor(Math.exp(logMin + (logMax - logMin) * t1))));
      let sumL = 0, sumR = 0, weightSum = 0;
      if (isPlaying) {
        for (let i = i0; i < i1; i++) {
          const w = Math.pow((i + 1) / N, pinkExp);
          sumL += this.fftBufL![i] * w;
          sumR += this.fftBufR![i] * w;
          weightSum += w;
        }
      }
      const tL = isPlaying ? sumL / Math.max(0.0001, weightSum * 255) : 0;
      const tR = isPlaying ? sumR / Math.max(0.0001, weightSum * 255) : 0;
      const aL = tL > this.barLvlL![b] ? 0.55 : 0.10;
      const aR = tR > this.barLvlR![b] ? 0.55 : 0.10;
      this.barLvlL![b] += (tL - this.barLvlL![b]) * aL;
      this.barLvlR![b] += (tR - this.barLvlR![b]) * aR;
      if (this.barLvlL![b] > this.peakHoldL![b]) this.peakHoldL![b] = this.barLvlL![b]; else this.peakHoldL![b] *= 0.985;
      if (this.barLvlR![b] > this.peakHoldR![b]) this.peakHoldR![b] = this.barLvlR![b]; else this.peakHoldR![b] *= 0.985;
    }
    return {
      left: this.barLvlL!,
      right: this.barLvlR!,
      peakL: this.peakHoldL!,
      peakR: this.peakHoldR!,
    };
  }

  getLevel(): number {
    if (!this.analyser || !this.analyserBuf || this.state !== "playing") {
      this.smoothLevel *= 0.9;
      return this.smoothLevel;
    }
    this.analyser.getFloatTimeDomainData(this.analyserBuf);
    let sum = 0;
    for (let i = 0; i < this.analyserBuf.length; i++) {
      const v = this.analyserBuf[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.analyserBuf.length);
    const target = Math.min(1, rms * 4);
    // smooth attack/release
    const a = target > this.smoothLevel ? 0.4 : 0.08;
    this.smoothLevel = this.smoothLevel + (target - this.smoothLevel) * a;
    return this.smoothLevel;
  }

  play(): void {
    if (!this.ctx || this.stems.length === 0) return;
    if (this.state === "playing") return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    let offset = this.startOffset;
    if (this.loopRange) {
      offset = Math.max(this.loopRange.from, Math.min(offset, this.loopRange.to - 0.001));
      this.startOffset = offset;
    }
    this.startCtxTime = this.ctx.currentTime;
    for (const stem of this.stems) {
      const src = this.ctx.createBufferSource();
      src.buffer = stem.activeBuffer;
      src.connect(stem.gain);
      const stretched = !!this.stretchInfo;
      if (!stretched) src.playbackRate.value = this.rate;
      if (stretched && this.stretchInfo) {
        // Stretched buffer = exactly the loop window scaled by timeRatio.
        src.loop = true;
        src.loopStart = 0;
        src.loopEnd = stem.activeBuffer.duration;
      } else if (this.loopRange) {
        src.loop = true;
        src.loopStart = this.loopRange.from;
        src.loopEnd = this.loopRange.to;
      }
      const startAt =
        stretched && this.stretchInfo
          ? Math.max(0, (offset - this.stretchInfo.loop.from) * this.stretchInfo.timeRatio)
          : offset;
      src.start(0, startAt);
      stem.source = src;
    }
    this.setState("playing");
  }

  pause(): void {
    if (this.state !== "playing" || !this.ctx) return;
    this.startOffset = this.currentTime;
    for (const stem of this.stems) {
      try { stem.source?.stop(); } catch { /* already stopped */ }
      stem.source = null;
    }
    this.setState("paused");
  }

  toggle(): void {
    if (this.state === "playing") this.pause();
    else this.play();
  }

  seek(time: number): void {
    const wasPlaying = this.state === "playing";
    if (wasPlaying) this.pause();
    this.startOffset = Math.max(0, Math.min(time, this.duration));
    if (wasPlaying) this.play();
  }

  setMuted(key: string, muted: boolean): void {
    const stem = this.stems.find((s) => s.key === key);
    if (!stem) return;
    stem.muted = muted;
    stem.gain.gain.value = muted ? 0 : 1;
  }

  setVolume(key: string, volume: number): void {
    const stem = this.stems.find((s) => s.key === key);
    if (!stem) return;
    stem.muted = volume <= 0;
    stem.gain.gain.value = Math.max(0, Math.min(1, volume));
  }

  setSolo(soloKey: string | null): void {
    for (const stem of this.stems) {
      const on = soloKey == null ? !stem.muted : stem.key === soloKey;
      stem.gain.gain.value = on ? 1 : 0;
    }
  }

  isMuted(key: string): boolean {
    return this.stems.find((s) => s.key === key)?.muted ?? false;
  }

  /** Set or clear an A-B loop window. Updates already-playing sources. */
  setLoop(range: { from: number; to: number } | null): void {
    this.loopRange = range;
    for (const stem of this.stems) {
      if (!stem.source) continue;
      if (range && range.to > range.from) {
        stem.source.loop = true;
        stem.source.loopStart = range.from;
        stem.source.loopEnd = range.to;
      } else {
        stem.source.loop = false;
      }
    }
  }

  /**
   * Apply independent time-stretch + pitch-shift to the current loop window
   * via offline rubberband processing. Pass `{ timeRatio: 1, pitchScale: 1 }`
   * to fall back to native playback (cheaper, no processing time).
   *
   * Regenerates each stem buffer; expect ~0.5–2 s per call for short loops.
   */
  async setTimePitch(timeRatio: number, pitchScale: number, loopRange?: { from: number; to: number }): Promise<void> {
    const range = loopRange ?? this.loopRange;
    if (!range || !this.ctx) return;

    const { isPassthrough, stretchAudioBuffer } = await import("./rubberband");

    const wasPlaying = this.state === "playing";
    const resumeAt = this.currentTime;
    if (wasPlaying) this.pause();

    if (isPassthrough(timeRatio, pitchScale)) {
      // Native mode.
      this.stretchInfo = null;
      for (const stem of this.stems) stem.activeBuffer = stem.buffer;
      this.loopRange = range;
    } else {
      const newBuffers = await Promise.all(
        this.stems.map((stem) =>
          stretchAudioBuffer(this.ctx!, stem.buffer, range.from, range.to, timeRatio, pitchScale),
        ),
      );
      this.stems.forEach((stem, i) => {
        stem.activeBuffer = newBuffers[i];
      });
      this.stretchInfo = { timeRatio, pitchScale, loop: { from: range.from, to: range.to } };
      this.loopRange = range;
    }

    this.startOffset = Math.max(range.from, Math.min(resumeAt, range.to - 0.001));
    if (wasPlaying) this.play();
  }

  /** Restart playback from the loop start (A marker). */
  seekToLoopStart(): void {
    if (this.loopRange) {
      this.seek(this.loopRange.from);
    } else {
      this.seek(0);
    }
  }

  /**
   * Apply a global playback rate to all sources. Note: this also shifts pitch
   * (Web Audio's `playbackRate` couples them). For independent control use
   * setTimePitch.
   */
  setPlaybackRate(rate: number): void {
    if (this.state === "playing" && this.ctx) {
      // Snapshot current playhead before changing the clock.
      this.startOffset = this.currentTime;
      this.startCtxTime = this.ctx.currentTime;
    }
    this.rate = rate;
    for (const stem of this.stems) {
      if (stem.source) stem.source.playbackRate.value = rate;
    }
  }

  get currentTime(): number {
    if (!this.ctx) return 0;
    if (this.stretchInfo) {
      const { from, to } = this.stretchInfo.loop;
      const stretchedLen = (to - from) * this.stretchInfo.timeRatio;
      let elapsedStretched = 0;
      if (this.state === "playing") {
        elapsedStretched =
          (this.startOffset - from) * this.stretchInfo.timeRatio +
          (this.ctx.currentTime - this.startCtxTime);
      } else {
        elapsedStretched = (this.startOffset - from) * this.stretchInfo.timeRatio;
      }
      if (stretchedLen > 0) {
        elapsedStretched = ((elapsedStretched % stretchedLen) + stretchedLen) % stretchedLen;
      }
      return from + elapsedStretched / this.stretchInfo.timeRatio;
    }
    let t = this.startOffset;
    if (this.state === "playing") {
      t = this.startOffset + (this.ctx.currentTime - this.startCtxTime) * this.rate;
    }
    if (this.loopRange) {
      const { from, to } = this.loopRange;
      const len = to - from;
      if (len > 0 && t >= from) {
        return from + ((t - from) % len);
      }
    }
    return t;
  }

  get totalDuration(): number {
    return this.duration;
  }

  dispose(): void {
    for (const stem of this.stems) {
      try { stem.source?.stop(); } catch { /* noop */ }
    }
    this.stems = [];
    this.ctx?.close();
    this.ctx = null;
    this.setState("idle");
  }

  private setState(s: EngineState) {
    this.state = s;
    this.onStateChange?.(s);
  }
}
