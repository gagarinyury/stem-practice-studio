"use client";

import { useEffect } from "react";
import Script from "next/script";
import { applyTheme, getWebApp } from "@/lib/telegram";

export function TelegramInit() {
  useEffect(() => {
    const init = () => {
      const wa = getWebApp();
      if (!wa) return;
      wa.ready();
      wa.expand();
      applyTheme(wa);
      const onViewport = () => applyTheme(wa);
      const onTheme = () => applyTheme(wa);
      wa.onEvent("viewportChanged", onViewport);
      wa.onEvent("themeChanged", onTheme);
      return () => {
        wa.offEvent("viewportChanged", onViewport);
        wa.offEvent("themeChanged", onTheme);
      };
    };
    if (getWebApp()) {
      return init();
    }
    const id = window.setInterval(() => {
      if (getWebApp()) {
        window.clearInterval(id);
        init();
      }
    }, 50);
    return () => window.clearInterval(id);
  }, []);

  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="beforeInteractive"
    />
  );
}
