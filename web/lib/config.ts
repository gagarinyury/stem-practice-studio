/**
 * Backend base URL. Works on both server (Node) and client (browser) because
 * NEXT_PUBLIC_* env vars are inlined at build time.
 *
 * Default points at evo (where the API is deployed). Override locally with:
 *   NEXT_PUBLIC_API_BASE=http://localhost:8090 npm run dev
 */
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE || "http://100.86.227.110:8090"
).replace(/\/+$/, "");
