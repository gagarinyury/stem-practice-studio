/**
 * Browser-side API client. Server components should use `manifest.server.ts`
 * (which wraps the same endpoints with `cache: "no-store"`).
 */
import { API_BASE } from "./config";
import { getToken, type AuthUser } from "./auth";
import type { Manifest } from "./manifest";

/**
 * Fetch wrapper that injects `Authorization: Bearer <token>` if a token exists.
 * Throws on non-2xx; surfaces backend `detail` if available.
 */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

async function jsonOrThrow<T>(resp: Response, label: string): Promise<T> {
  if (!resp.ok) {
    let detail = `${resp.status}`;
    try {
      const j = await resp.json();
      if (typeof j?.detail === "string") detail = j.detail;
    } catch {}
    throw new Error(`${label}: ${detail}`);
  }
  return resp.json();
}

// ===== Profile =====

export async function getProfile(): Promise<AuthUser> {
  return jsonOrThrow(await authedFetch("/profile"), "getProfile");
}

export async function patchProfile(patch: Partial<Pick<AuthUser, "language" | "voice_low" | "voice_high" | "voice_type">>): Promise<AuthUser> {
  return jsonOrThrow(
    await authedFetch("/profile", { method: "PATCH", body: JSON.stringify(patch) }),
    "patchProfile",
  );
}

// ===== Warmup =====

export interface WarmupSession {
  id: number;
  started_at: string;
  finished_at: string;
  duration_sec: number;
  steps_completed: number;
  steps_skipped: number;
  peak_note: string | null;
  accuracy_pct: number | null;
  smoothness: string | null;
  created_at: string;
}

export interface WarmupSessionInput {
  started_at: string;
  finished_at: string;
  duration_sec: number;
  steps_completed: number;
  steps_skipped: number;
  peak_note?: string | null;
  accuracy_pct?: number | null;
  smoothness?: string | null;
}

export async function postWarmupSession(input: WarmupSessionInput): Promise<WarmupSession> {
  return jsonOrThrow(
    await authedFetch("/warmup/sessions", { method: "POST", body: JSON.stringify(input) }),
    "postWarmupSession",
  );
}

export async function listWarmupSessions(limit = 10): Promise<WarmupSession[]> {
  return jsonOrThrow(await authedFetch(`/warmup/sessions?limit=${limit}`), "listWarmupSessions");
}

export async function getStreak(): Promise<{ streak_count: number; last_session_at: string | null }> {
  return jsonOrThrow(await authedFetch("/warmup/streak"), "getStreak");
}

export interface TrackSummary {
  id: string;
  title: string;
  artist: string | null;
  url: string | null;
  language: string;
  duration: number | null;
  status: "queued" | "processing" | "done" | "failed";
  created_at: string;
  error?: string;
}

export interface ProgressEvent {
  stage: string;
  pct?: number;
  message?: string;
  ts?: string;
}

export async function listTracks(): Promise<TrackSummary[]> {
  const r = await fetch(`${API_BASE}/tracks`, { cache: "no-store" });
  if (!r.ok) throw new Error(`listTracks: ${r.status}`);
  return r.json();
}

export async function getTrack(id: string): Promise<Manifest & TrackSummary> {
  const r = await fetch(`${API_BASE}/tracks/${id}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`getTrack ${id}: ${r.status}`);
  return r.json();
}

export async function uploadTrack(
  file: File,
  opts: { language?: string; title?: string; artist?: string } = {},
): Promise<{ id: string; status: string }> {
  const fd = new FormData();
  fd.append("file", file);
  if (opts.language) fd.append("language", opts.language);
  if (opts.title) fd.append("title", opts.title);
  if (opts.artist) fd.append("artist", opts.artist);
  const r = await fetch(`${API_BASE}/tracks`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`upload: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function submitYouTube(
  url: string,
  opts: { language?: string; title?: string; artist?: string } = {},
): Promise<{ id: string; status: string }> {
  const fd = new FormData();
  fd.append("url", url);
  if (opts.language) fd.append("language", opts.language);
  if (opts.title) fd.append("title", opts.title);
  if (opts.artist) fd.append("artist", opts.artist);
  const r = await fetch(`${API_BASE}/tracks`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`submitYouTube: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function deleteTrack(id: string): Promise<void> {
  const r = await fetch(`${API_BASE}/tracks/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404) throw new Error(`delete: ${r.status}`);
}

/**
 * Subscribe to a track's progress stream. Returns a cleanup function.
 * Calls `onEvent` for every parsed event; calls `onDone` once when terminal
 * (`stage` === "done" or "error") and closes the EventSource.
 */
export function subscribeProgress(
  id: string,
  onEvent: (e: ProgressEvent) => void,
  onDone?: (e: ProgressEvent) => void,
): () => void {
  const es = new EventSource(`${API_BASE}/tracks/${id}/events`);
  es.onmessage = (m) => {
    try {
      const ev = JSON.parse(m.data) as ProgressEvent;
      onEvent(ev);
      if (ev.stage === "done" || ev.stage === "error") {
        onDone?.(ev);
        es.close();
      }
    } catch {
      // ignore non-JSON keepalives
    }
  };
  es.onerror = () => {
    // Server may have closed cleanly after terminal event; let the consumer decide.
  };
  return () => es.close();
}
