export type StemKey = "vocals" | "drums" | "bass" | "guitar" | "piano" | "other";

export interface Manifest {
  id: string;
  title: string;
  artist: string;
  url: string;
  duration: number;
  language: string;
  stems: Record<StemKey, string>;
  lyrics: { raw_asr: string; engine: string };
  lrc: { found: boolean; artist?: string; title?: string };
  aligned: {
    path: string;
    match_rate: number;
    matched: number;
    lrc_words: number;
    interpolated: number;
  };
  timings_sec: Record<string, number>;
}

export interface AlignedWord {
  word: string;
  line: number;
  start: number;
  end: number;
  match: "asr" | "interp";
  asr_word?: string;
}

export interface AlignedLyrics {
  duration: number;
  lines: string[];
  text: string;
  words: AlignedWord[];
}

import { API_BASE } from "./config";

export function stemUrl(id: string, relPath: string): string {
  return `${API_BASE}/runs/${id}/${relPath}`;
}
