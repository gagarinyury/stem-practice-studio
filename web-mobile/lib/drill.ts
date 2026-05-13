import type { AlignedLyrics, AlignedWord } from "./manifest";

export interface Phrase {
  lineIndex: number | null;   // present when range maps to one full line
  totalLines: number;
  text: string;
  words: AlignedWord[];
  /** Loop start (sec). */
  from: number;
  /** Loop end (sec). */
  to: number;
}

/**
 * Pick a phrase for drilling. Three modes (in priority order):
 *  1. explicit `from`/`to` seconds → return all words inside [from, to]
 *  2. explicit `lineIndex` → return that line's words
 *  3. fallback → middle line that has aligned words
 */
export function pickPhrase(
  aligned: AlignedLyrics,
  opts: { fromSec?: number; toSec?: number; lineIndex?: number } = {},
): Phrase | null {
  if (!aligned?.words?.length) return null;
  const lines = aligned.lines ?? [];

  const grouped = new Map<number, AlignedWord[]>();
  for (const w of aligned.words) {
    if (!grouped.has(w.line)) grouped.set(w.line, []);
    grouped.get(w.line)!.push(w);
  }
  const linesWithWords = [...grouped.keys()].sort((a, b) => a - b);
  if (linesWithWords.length === 0) return null;

  // 1. Range mode
  if (typeof opts.fromSec === "number" && typeof opts.toSec === "number") {
    const from = Math.min(opts.fromSec, opts.toSec);
    const to = Math.max(opts.fromSec, opts.toSec);
    const words = aligned.words.filter((w) => w.end > from && w.start < to);
    if (words.length > 0) {
      const wLines = new Set(words.map((w) => w.line));
      const lineIndex = wLines.size === 1 ? words[0].line : null;
      const text =
        lineIndex !== null
          ? lines[lineIndex] ?? words.map((w) => w.word).join(" ")
          : words.map((w) => w.word).join(" ");
      return {
        lineIndex,
        totalLines: lines.length,
        text,
        words,
        from,
        to,
      };
    }
    // Range had no aligned words. Fall back to the closest line by midpoint.
    const mid = (from + to) / 2;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const lineNo of linesWithWords) {
      const ws = grouped.get(lineNo)!;
      const lineMid = (Math.min(...ws.map((w) => w.start)) + Math.max(...ws.map((w) => w.end))) / 2;
      const d = Math.abs(lineMid - mid);
      if (d < bestDist) {
        bestDist = d;
        best = lineNo;
      }
    }
    if (best !== null) {
      const ws = grouped.get(best)!;
      return {
        lineIndex: best,
        totalLines: lines.length,
        text: lines[best] ?? ws.map((w) => w.word).join(" "),
        words: ws,
        from: Math.min(...ws.map((w) => w.start)),
        to: Math.max(...ws.map((w) => w.end)),
      };
    }
    return null;
  }

  // 2. Explicit line
  const target =
    typeof opts.lineIndex === "number" && grouped.has(opts.lineIndex)
      ? opts.lineIndex
      : linesWithWords[Math.floor(linesWithWords.length / 2)];

  const words = grouped.get(target)!;
  return {
    lineIndex: target,
    totalLines: lines.length,
    text: lines[target] ?? words.map((w) => w.word).join(" "),
    words,
    from: Math.min(...words.map((w) => w.start)),
    to: Math.max(...words.map((w) => w.end)),
  };
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
