"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthGuard } from "./AuthGuard";
import { BottomNav } from "./BottomNav";
import { DevTourBar } from "./DevTourBar";
import { TapTestBar } from "./TapTestBar";
import { hasBottomNav } from "@/lib/nav-visibility";

const PUBLIC_PATHS = ["/login", "/design", "/onboarding/language"];
const DEV = process.env.NODE_ENV !== "production";

/**
 * Top-level wrapper. Renders children unconditionally; language check just
 * schedules a redirect.
 *
 * `data-bottomnav` is set on <html> via an effect — putting it on a wrapper
 * div with `display:contents` triggered a WKWebView bug where descendant
 * pointer events were swallowed. <html> avoids the wrapper entirely.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isTour = pathname.startsWith("/design/tour");
  const isLanguageOnboarding = pathname.startsWith("/onboarding/language");

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.bottomnav = hasBottomNav(pathname) ? "true" : "false";
  }, [pathname]);

  // iOS 26 WKWebView regression: the new gesture-recognizer priority swallows
  // synthetic click events on <button>, so React onClick never fires inside
  // Capacitor. Range inputs still work because they go through native touch.
  // Fix by manually translating short, stationary touches on clickable
  // ancestors into a programmatic click. Capacitor-only — Mac Safari and
  // mobile Safari are unaffected because they don't expose window.Capacitor.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Capacitor" in window)) return;

    let target: Element | null = null;
    let x = 0;
    let y = 0;
    let t0 = 0;

    function onStart(e: TouchEvent) {
      if (e.touches.length !== 1) { target = null; return; }
      const touch = e.touches[0];
      target = (e.target as Element).closest('button, a, [role="button"]');
      x = touch.clientX;
      y = touch.clientY;
      t0 = Date.now();
    }

    function onEnd(e: TouchEvent) {
      const el = target;
      target = null;
      if (!el) return;
      if (el.hasAttribute("disabled")) return;
      if (Date.now() - t0 > 500) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      if (Math.abs(touch.clientX - x) > 10) return;
      if (Math.abs(touch.clientY - y) > 10) return;
      const endEl = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!endEl || !el.contains(endEl)) return;
      (el as HTMLElement).click();
    }

    // Both passive: true so we never block momentum scroll inside the
    // library list. We don't preventDefault — if iOS later fires a real
    // click on its own it'll be a no-op double dispatch, and currently it
    // doesn't fire at all (that's the bug we're patching).
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, []);

  useEffect(() => {
    if (isLanguageOnboarding || pathname.startsWith("/design") || DEV) return;
    try {
      const lang = window.localStorage.getItem("app.language");
      if (!lang) router.replace("/onboarding/language");
    } catch {}
  }, [pathname, router, isLanguageOnboarding]);

  if (isPublic) {
    return (
      <>
        {children}
        {DEV && !isTour && <DevTourBar />}
        {DEV && <TapTestBar />}
      </>
    );
  }
  if (DEV) {
    return (
      <>
        {children}
        <BottomNav />
        {!isTour && <DevTourBar />}
        <TapTestBar />
      </>
    );
  }
  return (
    <AuthGuard>
      {children}
      <BottomNav />
    </AuthGuard>
  );
}
