"use client";

import { useEffect, useRef, useState } from "react";
import { getLocalVideoBlobUrl } from "@/lib/local-video";

interface Props {
  trackId: string;
  currentTime: number;
  playing: boolean;
}

export function LocalVideoBackground({ trackId, currentTime, playing }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [mime, setMime] = useState<string>("video/mp4");

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    console.log("[LVB] mount", { trackId });
    getLocalVideoBlobUrl(trackId)
      .then((res) => {
        if (cancelled || !res) return;
        createdUrl = res.url;
        setBlobUrl(res.url);
        setMime(res.mime);
        console.log("[LVB] blobUrl set");
      })
      .catch((e) => {
        console.warn("[LVB] failed to load blob", {
          message: e?.message,
          name: e?.name,
          raw: String(e),
        });
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      console.log("[LVB] unmount");
    };
  }, [trackId]);

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
          console.warn("[LVB] video error", {
            errorCode: v.error?.code,
            errorMessage: v.error?.message,
            readyState: v.readyState,
            networkState: v.networkState,
          });
        }}
        onLoadedMetadata={() => console.log("[LVB] metadata loaded")}
      >
        <source src={blobUrl} type={mime} />
      </video>
    </div>
  );
}
