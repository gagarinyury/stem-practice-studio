/**
 * Warm-up audio engine: Salamander piano (sampler) + simple synths for drones
 * and the siren glissando. Same logic as the prototype `audioFor` map.
 *
 * Browsers require a user gesture before audio starts — call `init()` on click.
 */
import * as Tone from "tone";

import type { StepKey } from "./protocol";
import type { StepNotes } from "./transpose";

let piano: Tone.Sampler | null = null;
let pianoReady = false;

export async function ensureAudio(): Promise<void> {
  if (piano) return;
  await Tone.start();
  piano = new Tone.Sampler({
    urls: {
      A2: "A2.mp3",
      C3: "C3.mp3",
      "D#3": "Ds3.mp3",
      "F#3": "Fs3.mp3",
      A3: "A3.mp3",
      C4: "C4.mp3",
      "D#4": "Ds4.mp3",
      "F#4": "Fs4.mp3",
    },
    baseUrl: "https://tonejs.github.io/audio/salamander/",
    release: 1,
    volume: -6,
  }).toDestination();
  await Tone.loaded();
  pianoReady = true;
}

export type AudioCleanup = () => void;

/** Start audio for a step. Returns a cleanup function to stop it. */
export function playStep(key: StepKey, notes: StepNotes): AudioCleanup {
  switch (key) {
    case "release":
      return () => {};
    case "sovt": {
      const drone = new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.4, decay: 0, sustain: 1, release: 0.6 },
        volume: -22,
      }).toDestination();
      drone.triggerAttack(notes.drone || "C3");
      return () => {
        drone.triggerRelease();
        setTimeout(() => drone.dispose(), 1000);
      };
    }
    case "siren": {
      const low = Tone.Frequency(notes.sirenLow || "A2").toFrequency();
      const high = Tone.Frequency(notes.sirenHigh || "F4").toFrequency();
      const osc = new Tone.Oscillator(low, "triangle").toDestination();
      osc.volume.value = -20;
      osc.start();
      let dir: "up" | "down" = "up";
      let tid: ReturnType<typeof setTimeout> | null = null;
      const stepLoop = () => {
        osc.frequency.rampTo(dir === "up" ? high : low, 1.9);
        dir = dir === "up" ? "down" : "up";
        tid = setTimeout(stepLoop, 1900);
      };
      stepLoop();
      return () => {
        if (tid) clearTimeout(tid);
        osc.stop();
        setTimeout(() => osc.dispose(), 200);
      };
    }
    case "scale":
    case "stacc":
      return () => {};
    case "swell": {
      const s = new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.3, decay: 0, sustain: 1, release: 0.6 },
      }).toDestination();
      s.volume.value = -36;
      s.triggerAttack(notes.swell || "D3");
      let phase = 0;
      const tid = setInterval(() => {
        const t = phase / 60;
        const env = Math.sin(Math.PI * t); // 0..1..0
        s.volume.value = -36 + 30 * env;
        phase = (phase + 1) % 60;
      }, 100);
      return () => {
        clearInterval(tid);
        s.triggerRelease();
        setTimeout(() => s.dispose(), 800);
      };
    }
    case "cool": {
      const drone = new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.6, decay: 0, sustain: 1, release: 1.5 },
        volume: -28,
      }).toDestination();
      drone.triggerAttack(notes.cool || "D3");
      return () => {
        drone.triggerRelease();
        setTimeout(() => drone.dispose(), 2000);
      };
    }
  }
}

/** For scale/staccato — fired by the visual loop when a rung lights up. */
export function pianoNote(note: string, duration: string = "8n"): void {
  if (pianoReady && piano) piano.triggerAttackRelease(note, duration);
}
