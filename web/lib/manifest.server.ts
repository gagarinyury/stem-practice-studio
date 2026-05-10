import "server-only";
import { API_BASE } from "./config";
import type { AlignedLyrics, Manifest } from "./manifest";

/**
 * Server-component loader. Fetches from the backend (CORS not required for
 * server-to-server). `cache: "no-store"` so processing-state changes are
 * always fresh during a render.
 */
export async function loadManifest(id: string): Promise<Manifest> {
  const r = await fetch(`${API_BASE}/tracks/${id}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`loadManifest ${id}: ${r.status}`);
  const parsed = (await r.json()) as Manifest;
  parsed.id = id;
  return parsed;
}

export async function loadAligned(id: string, relPath: string): Promise<AlignedLyrics> {
  const r = await fetch(`${API_BASE}/runs/${id}/${relPath}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`loadAligned ${id}/${relPath}: ${r.status}`);
  return (await r.json()) as AlignedLyrics;
}
