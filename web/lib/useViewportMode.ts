"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type ViewportMode = "phone-portrait" | "phone-landscape" | "desktop";

function detect(): ViewportMode {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  const h = window.innerHeight;
  // In a Capacitor native shell we are always on a phone — no matter what
  // the WebView reports for innerWidth (it can briefly spike past 1024px
  // on reflow after video metadata loads, swapping us into desktop mode).
  const native = Capacitor.isNativePlatform();
  if (!native && w >= 1024) return "desktop";
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
