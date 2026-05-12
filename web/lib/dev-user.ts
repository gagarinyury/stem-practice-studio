import type { AuthUser } from "./auth";

export const DEV = process.env.NODE_ENV !== "production";

/**
 * Synthetic user used when `getProfile` fails during dev (no token,
 * backend offline, etc.). Lets the DevTourBar walk through every screen
 * without forcing login first.
 */
export const DEV_USER: AuthUser = {
  id: 0,
  email: "dev@local",
  language: "English",
  voice_low: "C3",
  voice_high: "C5",
  voice_type: "tenor",
  streak_count: 3,
  last_session_at: null,
};
