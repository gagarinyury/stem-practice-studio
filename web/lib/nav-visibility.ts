// Single source of truth for "does this route show the floating BottomNav?".
// Used by both BottomNav (to render itself) and AppShell (to flip the
// body[data-bottomnav] flag that drives --bottom-reserve in CSS).
// Bar is shown on most main screens, including /karaoke (the landscape
// variant covers it via z-index inside KaraokeView). Hidden on focused
// flows: login, onboarding, processing wait, in-session warm-up, drill,
// and the design tour playground.
const HIDDEN_PREFIXES = [
  "/login",
  "/onboarding",
  "/warmup/onboarding",
  "/warmup/session",
  "/processing",
  "/design",
];

export function hasBottomNav(pathname: string): boolean {
  return !HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
