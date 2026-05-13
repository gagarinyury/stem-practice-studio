"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthGuard } from "./AuthGuard";
import { BottomNav } from "./BottomNav";
import { DevTourBar } from "./DevTourBar";
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
      </>
    );
  }
  if (DEV) {
    return (
      <>
        {children}
        <BottomNav />
        {!isTour && <DevTourBar />}
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
