"use client";

import { useEffect, useRef, useState } from "react";
import { readLocalVideoAsBlobUrl } from "@/lib/local-video";

interface Props {
  path: string;
  mime: string;
  currentTime: number;
  playing: boolean;
}

export function LocalVideoBackground({ path, mime, currentTime, playing }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    readLocalVideoAsBlobUrl(path, mime)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        url = u;
        setBlobUrl(u);
      })
      .catch((e) => console.warn("[LocalVideoBackground] failed to load blob", e));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, mime]);

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

  if (!blobUrl) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <video
        ref={ref}
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-cover"
        onError={(e) => {
          const v = e.currentTarget;
          console.warn("[LocalVideoBackground] error", {
            mime,
            errorCode: v.error?.code,
            errorMessage: v.error?.message,
            readyState: v.readyState,
            networkState: v.networkState,
          });
        }}
        onLoadedMetadata={() => console.log("[LocalVideoBackground] metadata loaded")}
      >
        <source src={blobUrl} type={mime} />
      </video>
    </div>
  );
}
