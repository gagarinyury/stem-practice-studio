"use client";

import { useEffect, useId, useRef, useState } from "react";

interface YTPlayer {
  mute: () => void;
  seekTo: (s: number, allowSeek?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  cueVideoById: (id: string, startSeconds?: number) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
}

interface YTNamespace {
  Player: new (id: string, opts: object) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface Props {
  videoId: string;
  currentTime: number;
  playing: boolean;
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadYTApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

export function YouTubeBackground({ videoId, currentTime, playing }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const playingRef = useRef(playing);
  const timeRef = useRef(currentTime);
  playingRef.current = playing;
  timeRef.current = currentTime;
  const reactId = useId();
  const elemId = `yt-bg-${reactId.replace(/:/g, "")}`;
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;
      const containerRatio = w / h;
      const VIDEO_RATIO = 16 / 9;
      // We render iframe at full container size. YouTube letterboxes the video
      // inside that box. Compute scale that makes the actual video fill.
      const s = containerRatio > VIDEO_RATIO ? containerRatio / VIDEO_RATIO : VIDEO_RATIO / containerRatio;
      setScale(s);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    loadYTApi().then((YT) => {
      if (disposed) return;
      playerRef.current = new YT.Player(elemId, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3,
          playsinline: 1,
        },
        events: {
          onReady: (e: { target: YTPlayer }) => {
            e.target.mute();
            readyRef.current = true;
            // Cue the video so iOS Safari renders the poster frame even before play.
            try { e.target.cueVideoById(videoId, timeRef.current); } catch {}
            try { e.target.seekTo(timeRef.current, true); } catch {}
            if (playingRef.current) {
              try { e.target.playVideo(); } catch {}
            } else {
              try { e.target.pauseVideo(); } catch {}
            }
          },
        },
      });
    });
    return () => {
      disposed = true;
      readyRef.current = false;
      playerRef.current = null;
    };
  }, [videoId]);

  // Drive playback state
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    if (playing) p.playVideo();
    else p.pauseVideo();
  }, [playing]);

  // Drift correction every 750ms — only while engine is playing
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = playerRef.current;
      if (!p || !readyRef.current) return;
      if (!playingRef.current) return;
      try {
        const ytTime = p.getCurrentTime();
        if (Math.abs(ytTime - timeRef.current) > 0.4) {
          p.seekTo(timeRef.current, true);
        }
      } catch { /* not ready */ }
    }, 750);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        id={elemId}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "100%",
          height: "100%",
          transform: `translate(-50%, -50%) scale(${scale.toFixed(3)})`,
          transformOrigin: "center center",
        }}
      />
    </div>
  );
}
