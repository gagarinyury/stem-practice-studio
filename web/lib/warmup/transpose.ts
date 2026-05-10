/**
 * Pick exercise notes based on the user's voice range. Default fallback
 * is a baritone-friendly C3 anchor when the profile has no range yet.
 */
import { midiOf, nameOf } from "../notes";

export interface VoiceRange {
  low: string;  // e.g. "C3"
  high: string; // e.g. "F4"
}

const FALLBACK: VoiceRange = { low: "C3", high: "F4" };

export function pickRange(profile: { voice_low: string | null; voice_high: string | null }): VoiceRange {
  if (profile.voice_low && profile.voice_high) {
    return { low: profile.voice_low, high: profile.voice_high };
  }
  return FALLBACK;
}

/** Note placed `semitones` above `from`. */
function above(from: string, semitones: number): string {
  return nameOf(midiOf(from) + semitones);
}

/**
 * For each step, return the concrete notes the audio engine should play.
 * Comfortable anchor: ~30–50% into the user's range from the bottom.
 */
export interface StepNotes {
  drone?: string;
  sirenLow?: string;
  sirenHigh?: string;
  scale?: string[];
  arpeggio?: string[];
  swell?: string;
  cool?: string;
}

export function notesFor(step: string, range: VoiceRange): StepNotes {
  const lo = midiOf(range.low);
  const hi = midiOf(range.high);
  const span = Math.max(0, hi - lo);

  // anchor ~3 semitones above lowest comfortable note
  const anchor = nameOf(lo + Math.min(3, span));
  // mid ~40% into the range
  const mid = nameOf(Math.round(lo + span * 0.4));

  switch (step) {
    case "sovt":
      return { drone: anchor };
    case "siren":
      return { sirenLow: range.low, sirenHigh: range.high };
    case "scale":
      // 1-2-3-4-5 from anchor, diatonic major (whole-whole-half-whole)
      return {
        scale: [
          anchor,
          above(anchor, 2),
          above(anchor, 4),
          above(anchor, 5),
          above(anchor, 7),
        ],
      };
    case "swell":
      return { swell: mid };
    case "stacc":
      // 1-3-5-8 from anchor
      return {
        arpeggio: [anchor, above(anchor, 4), above(anchor, 7), above(anchor, 12)],
      };
    case "cool":
      return { cool: mid };
    default:
      return {};
  }
}
