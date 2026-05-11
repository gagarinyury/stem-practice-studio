"use client";

import { useEffect, useRef } from "react";

interface Props {
  src: string;
  mime: string;
  currentTime: number;
  playing: boolean;
}

export function LocalVideoBackground({ src, mime, currentTime, playing }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (Math.abs(v.currentTime - currentTime) > 0.4) {
      try { v.currentTime = currentTime; } catch {}
    }
  }, [currentTime]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <video
        ref={ref}
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-cover"
      >
        <source src={src} type={mime} />
      </video>
    </div>
  );
}
