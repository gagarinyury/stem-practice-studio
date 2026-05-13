"use client";

import { useEffect, useLayoutEffect, useState } from "react";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type ViewportMode = "phone-portrait" | "phone-landscape" | "desktop";

function detect(): ViewportMode {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Touchscreens (Safari iPhone, Capacitor WKWebView, Android) always report
  // `pointer: coarse`. Relying on Capacitor.isNativePlatform() was racy — the
  // native bridge injects after first paint when running off a dev server,
  // so innerWidth spikes past 1024 during video-metadata reflow swapped us
  // into desktop mode. `pointer: fine` is set synchronously by the platform.
  const fine = window.matchMedia?.("(pointer: fine)").matches ?? false;
  if (fine && w >= 1024) return "desktop";
  if (h > w) return "phone-portrait";
  return "phone-landscape";
}

export function useViewportMode(): ViewportMode {
  const [mode, setMode] = useState<ViewportMode>("desktop");

  useIsoLayoutEffect(() => {
    setMode(detect());
  }, []);

  useEffect(() => {
    const update = () => setMode(detect());
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return mode;
}
