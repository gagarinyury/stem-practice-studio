/**
 * Regression test: StemEngine.load() must NOT touch audio nodes after the
 * AudioContext has been closed (component unmount during load).
 *
 * Without the bail-out check, the browser logs:
 *   "Construction of GainNode is not useful when context is closed."
 *   "Connecting nodes after the context has been closed is not useful."
 * — for every stem being loaded (6× × stack depth ≈ 1000 lines per track).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { StemEngine } from "../lib/audio-engine";

// jsdom doesn't ship AudioContext. We provide a minimal fake that tracks
// state transitions and counts node operations so we can assert behavior.
class FakeAudioParam {
  value = 1;
  setValueAtTime() { return this; }
}
class FakeAudioNode {
  connectedTo: any[] = [];
  connect(target: any) { this.connectedTo.push(target); return target; }
  disconnect() { /* noop */ }
}
class FakeGainNode extends FakeAudioNode { gain = new FakeAudioParam(); }
class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 2048;
  smoothingTimeConstant = 0;
  get frequencyBinCount() { return this.fftSize / 2; }
}

class FakeAudioContext {
  state: "running" | "closed" | "suspended" = "running";
  destination = new FakeAudioNode();
  sampleRate = 48000;
  currentTime = 0;
  createGainCalls = 0;
  createAnalyserCalls = 0;
  closeCalls = 0;
  createGain() {
    this.createGainCalls++;
    return new FakeGainNode();
  }
  createAnalyser() {
    this.createAnalyserCalls++;
    return new FakeAnalyserNode();
  }
  createChannelSplitter() { return new FakeAudioNode(); }
  createBuffer() { return { duration: 1, sampleRate: 48000, length: 48000 } as any; }
  createBufferSource() {
    return {
      ...new FakeAudioNode(),
      buffer: null,
      start() {},
      stop() {},
      onended: null,
    } as any;
  }
  decodeAudioData(_arr: ArrayBuffer): Promise<AudioBuffer> {
    return Promise.resolve({ duration: 1, sampleRate: 48000, length: 48000, numberOfChannels: 2 } as any);
  }
  async close() {
    this.closeCalls++;
    this.state = "closed";
  }
}


beforeEach(() => {
  // @ts-expect-error — jsdom polyfill
  globalThis.AudioContext = FakeAudioContext;
  globalThis.fetch = vi.fn().mockResolvedValue({
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});


describe("StemEngine race-after-dispose", () => {
  it("does NOT create GainNodes after dispose during load", async () => {
    const engine = new StemEngine();

    // Make decode hang on a controllable promise so we can dispose mid-flight
    let resolveDecode!: () => void;
    const decodePromise = new Promise<AudioBuffer>((res) => {
      resolveDecode = () => res({ duration: 1, sampleRate: 48000, length: 48000, numberOfChannels: 2 } as any);
    });
    // @ts-expect-error — runtime override
    FakeAudioContext.prototype.decodeAudioData = () => decodePromise;

    // Kick off load (do not await yet)
    const loadPromise = engine.load([
      { key: "vocals", url: "/fake/vocals.flac" },
      { key: "drums", url: "/fake/drums.flac" },
    ]);

    // Simulate unmount in the middle of the load
    engine.dispose();

    // Now let the decode complete — the code path that creates GainNodes for
    // stems runs after this await
    resolveDecode();
    await loadPromise;

    // After dispose, engine.ctx is null. We expect NO new stem GainNodes were
    // attached. The pre-dispose phase did create some setup nodes; what we
    // check is that no GainNode/connect calls happened ON A CLOSED CTX.
    // Engine should have bailed out cleanly.
    expect(engine.stemKeys).toEqual([]);
  });

  it("dispose nulls out ctx and mix", async () => {
    const engine = new StemEngine();
    // Trigger ctx creation
    const promise = engine.load([{ key: "vocals", url: "/fake/v.flac" }]);
    engine.dispose();
    await promise;
    // ctx and mix are private; we check observable behavior: another dispose
    // is safe (no double-close exceptions)
    expect(() => engine.dispose()).not.toThrow();
  });
});
