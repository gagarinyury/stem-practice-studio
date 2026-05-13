import { API_BASE } from "./config";

export type StemKey = "vocals" | "drums" | "bass" | "guitar" | "piano" | "other" | "music";

export interface Manifest {
  id: string;
  title: string;
  artist: string | null;
  url: string | null;
  duration: number | null;
  language: string;
  stems: Record<StemKey, string>;
  lyrics: { raw_asr: string; engine: string } | null;
  lrc: {
    found: boolean;
    artist?: string | null;
    title?: string | null;
    duration?: number | null;
    synced?: boolean;
    partial?: boolean;
    reason?: LyricsReason | string | null;
  };
  aligned: {
    path: string;
    match_rate: number | null;
    matched: number;
    lrc_words: number;
    interpolated: number;
    asr_only?: boolean;
    partial?: boolean;
    reason?: LyricsReason | string | null;
  } | null;
  timings_sec: Record<string, number>;
}

export type LyricsReason =
  | "lrclib_not_found"
  | "lrclib_rejected_low_match"
  | "script_mismatch"
  | "unsupported_or_weak_asr_language"
  | "partial_cover_available";

export interface AlignedWord {
  word: string;
  line: number;
  start: number;
  end: number;
  match: "asr" | "interp";
  asr_word?: string;
}

export interface AlignedLyrics {
  model?: string;
  engine?: string;
  duration: number;
  lrc_source?: Manifest["lrc"] | null;
  alignment?: Record<string, unknown> | null;
  lines: string[];
  text: string;
  words: AlignedWord[];
}

export function stemUrl(id: string, relPath: string): string {
  return `${API_BASE}/runs/${id}/${relPath}`;
}

export function videoUrl(id: string): string {
  return `${API_BASE}/runs/${id}/video.mp4`;
}
