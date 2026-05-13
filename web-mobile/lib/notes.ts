/**
 * Note ↔ Hz ↔ MIDI helpers. A4 = 440 Hz = MIDI 69. All pure functions.
 */

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const PITCH_INDEX: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

const A4_HZ = 440;
const A4_MIDI = 69;

/** Convert frequency in Hz to MIDI note number (float). */
export function hzToMidi(hz: number): number {
  return 12 * Math.log2(hz / A4_HZ) + A4_MIDI;
}

/** Convert MIDI note (int or float — rounded) to Hz. */
export function midiToHz(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Parse note name like "C3", "F#4", "Eb2" → MIDI. Returns NaN on bad input. */
export function midiOf(name: string): number {
  const m = name.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!m) return NaN;
  const cls = m[1][0].toUpperCase() + m[1].slice(1);
  const oct = parseInt(m[2], 10);
  const pc = PITCH_INDEX[cls];
  if (pc === undefined) return NaN;
  return (oct + 1) * 12 + pc;
}

/** Get canonical note name from MIDI (e.g. 60 → "C4"). */
export function nameOf(midi: number): string {
  const m = Math.round(midi);
  const oct = Math.floor(m / 12) - 1;
  const pc = PITCH_CLASSES[((m % 12) + 12) % 12];
  return `${pc}${oct}`;
}

export interface NoteResult {
  /** Closest canonical name, e.g. "F#4" */
  name: string;
  /** Closest integer MIDI */
  midi: number;
  /** Detuning in cents from the closest note (-50..+50) */
  cents: number;
}

/** Convert Hz → closest note + cents offset. */
export function hzToNote(hz: number): NoteResult {
  const midiF = hzToMidi(hz);
  const midi = Math.round(midiF);
  const cents = Math.round((midiF - midi) * 100);
  return { name: nameOf(midi), midi, cents };
}

/** Semitone distance between two notes (positive = higher). */
export function semitonesBetween(a: string, b: string): number {
  return midiOf(b) - midiOf(a);
}

/** Pick a voice type label from a [low, high] range. Heuristic — based on overall span midpoint. */
export function inferVoiceType(low: string, high: string): string {
  const lo = midiOf(low);
  const hi = midiOf(high);
  if (Number.isNaN(lo) || Number.isNaN(hi)) return "voice";
  const mid = (lo + hi) / 2;
  // Bass C2(36)–E4(64), Baritone E2(40)–A4(69), Tenor C3(48)–C5(72),
  // Alto F3(53)–F5(77), Soprano C4(60)–C6(84). Pick the band whose center is closest.
  const bands: Array<{ name: string; center: number }> = [
    { name: "bass", center: (36 + 64) / 2 },
    { name: "baritone", center: (40 + 69) / 2 },
    { name: "tenor", center: (48 + 72) / 2 },
    { name: "alto", center: (53 + 77) / 2 },
    { name: "soprano", center: (60 + 84) / 2 },
  ];
  let best = bands[0];
  let bestDist = Infinity;
  for (const b of bands) {
    const d = Math.abs(mid - b.center);
    if (d < bestDist) { best = b; bestDist = d; }
  }
  return best.name;
}
