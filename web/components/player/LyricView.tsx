"use client";

import { useMemo } from "react";
import type { AlignedWord } from "@/lib/manifest";

interface Props {
  words: AlignedWord[];
  lines: string[];
  currentTime: number;
}

export function LyricView({ words, lines, currentTime }: Props) {
  const { activeLine, lineWords } = useMemo(() => {
    const byLine = new Map<number, AlignedWord[]>();
    for (const w of words) {
      if (!byLine.has(w.line)) byLine.set(w.line, []);
      byLine.get(w.line)!.push(w);
    }
    let line = 0;
    for (const w of words) {
      if (w.start <= currentTime) line = w.line;
      else break;
    }
    return { activeLine: line, lineWords: byLine };
  }, [words, currentTime]);

  const prev = lines[activeLine - 1] ?? "";
  const cur = lineWords.get(activeLine);
  const next = lines[activeLine + 1] ?? "";

  return (
    <div
      className="grid h-[110px] grid-rows-[24px_60px_24px] items-center overflow-hidden px-6 text-center"
    >
      <div className="truncate font-serif text-[16px] italic leading-[1.3] text-ink-faint">
        {prev || " "}
      </div>

      <div className="line-clamp-2 font-serif text-[22px] leading-[1.3] text-ink">
        {cur?.length ? (
          cur.map((w, i) => {
            const past = currentTime >= w.end;
            const current = currentTime >= w.start && currentTime < w.end;
            if (current) {
              return (
                <span key={i} className="rounded-[3px] bg-accent-vocal px-1 text-paper">
                  {w.word}{" "}
                </span>
              );
            }
            return (
              <span key={i} className={past ? "text-ink" : "text-ink-faint"}>
                {w.word}{" "}
              </span>
            );
          })
        ) : (
          <span className="italic text-ink-faint">{lines[activeLine] || " "}</span>
        )}
      </div>

      <div className="truncate font-serif text-[16px] italic leading-[1.3] text-ink-faint">
        {next || " "}
      </div>
    </div>
  );
}
