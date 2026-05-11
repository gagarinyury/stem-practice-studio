// Single source of truth for "does this route show the floating BottomNav?".
// Used by both BottomNav (to render itself) and AppShell (to flip the
// body[data-bottomnav] flag that drives --bottom-reserve in CSS).
const HIDDEN_PREFIXES = [
  "/login",
  "/onboarding",
  "/warmup/onboarding",
  "/warmup/session",
  "/processing",
  "/karaoke",
  "/select",
  "/drill",
  "/design",
];

export function hasBottomNav(pathname: string): boolean {
  return !HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
