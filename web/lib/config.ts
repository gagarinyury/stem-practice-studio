/**
 * Backend base URLs.
 *
 * `API_BASE` is for browser/client code. Set to `/be` so requests go through
 * the same-origin proxy declared in `next.config.ts`. That avoids mixed-content
 * blocking (https → http) and CORS on iPhone via Capacitor.
 *
 * `API_BASE_SERVER` is for Server Components and other Node-side fetches.
 * Those can talk to the backend directly over HTTP — no browser security model.
 * Set via `NEXT_PUBLIC_BACKEND_ORIGIN` env if you want to override.
 */
export const API_BASE = "/be";

export const API_BASE_SERVER = (
  process.env.NEXT_PUBLIC_BACKEND_ORIGIN || "http://100.86.227.110:8093"
).replace(/\/+$/, "");
