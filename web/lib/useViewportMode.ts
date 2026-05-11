"use client";

import { useEffect, useState } from "react";

export type ViewportMode = "phone-portrait" | "phone-landscape" | "desktop";

function detect(): ViewportMode {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w >= 1024) return "desktop";
  if (h > w) return "phone-portrait";
  return "phone-landscape";
}

export function useViewportMode(): ViewportMode {
  const [mode, setMode] = useState<ViewportMode>("desktop");

  useEffect(() => {
    const update = () => setMode(detect());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return mode;
}
