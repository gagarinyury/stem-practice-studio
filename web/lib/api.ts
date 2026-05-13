import { API_BASE } from "./config";
import type { AlignedLyrics, Manifest } from "./manifest";

export interface User {
  id: string;
  email: string;
  role: "admin" | "teacher" | "student" | string;
  created_at: number;
}

export interface TrackSummary {
  id: string;
  title: string;
  artist: string | null;
  url: string | null;
  language: string;
  duration: number | null;
  source?: {
    audio?: string | null;
    stream?: string | null;
    video?: string | null;
  } | null;
  status: "queued" | "processing" | "done" | "failed";
  created_at: string;
  error?: string;
}

export interface ProgressEvent {
  stage: string;
  pct?: number;
  message?: string;
  ts?: string;
  title?: string | null;
  artist?: string | null;
  lrc?: Manifest["lrc"] | null;
  aligned?: Manifest["aligned"] | null;
  stems?: string[];
  source?: TrackSummary["source"] | null;
}

async function authJson(path: string, body: { email: string; password: string }): Promise<{ user: User }> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function login(email: string, password: string): Promise<{ user: User }> {
  return authJson("/auth/login", { email, password });
}

export async function register(email: string, password: string): Promise<{ user: User }> {
  return authJson("/auth/register", { email, password });
}

export async function getMe(): Promise<{ user: User }> {
  const r = await fetch(`${API_BASE}/auth/me`, { cache: "no-store", credentials: "same-origin" });
  if (!r.ok) throw new Error(`me: ${r.status}`);
  return r.json();
}

export async function logout(): Promise<void> {
  const r = await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "same-origin" });
  if (!r.ok) throw new Error(`logout: ${r.status}`);
}

export async function listTracks(): Promise<TrackSummary[]> {
  const r = await fetch(`${API_BASE}/tracks`, { cache: "no-store", credentials: "same-origin" });
  if (!r.ok) throw new Error(`listTracks: ${r.status}`);
  return r.json();
}

export async function getTrack(id: string): Promise<Manifest & TrackSummary> {
  const r = await fetch(`${API_BASE}/tracks/${id}`, { cache: "no-store", credentials: "same-origin" });
  if (!r.ok) throw new Error(`getTrack ${id}: ${r.status}`);
  return r.json();
}

export async function getAligned(id: string, relPath: string): Promise<AlignedLyrics> {
  const r = await fetch(`${API_BASE}/runs/${id}/${relPath}`, { cache: "no-store", credentials: "same-origin" });
  if (!r.ok) throw new Error(`getAligned ${id}: ${r.status}`);
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
  const r = await fetch(`${API_BASE}/tracks`, { method: "POST", body: fd, credentials: "same-origin" });
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
  const r = await fetch(`${API_BASE}/tracks`, { method: "POST", body: fd, credentials: "same-origin" });
  if (!r.ok) throw new Error(`submitYouTube: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function deleteTrack(id: string): Promise<void> {
  const r = await fetch(`${API_BASE}/tracks/${id}`, { method: "DELETE", credentials: "same-origin" });
  if (!r.ok && r.status !== 404) throw new Error(`delete: ${r.status}`);
}

export async function acceptLyricsCandidate(id: string, candidateId: number): Promise<Manifest & TrackSummary> {
  const fd = new FormData();
  fd.append("candidate_id", String(candidateId));
  const r = await fetch(`${API_BASE}/tracks/${id}/lyrics/accept`, { method: "POST", body: fd, credentials: "same-origin" });
  if (!r.ok) throw new Error(`acceptLyricsCandidate ${id}: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function searchLyricsManually(
  id: string,
  opts: { title: string; artist?: string },
): Promise<Manifest & TrackSummary> {
  const fd = new FormData();
  fd.append("title", opts.title);
  if (opts.artist) fd.append("artist", opts.artist);
  const r = await fetch(`${API_BASE}/tracks/${id}/lyrics/search`, { method: "POST", body: fd, credentials: "same-origin" });
  if (!r.ok) throw new Error(`searchLyricsManually ${id}: ${r.status} ${await r.text()}`);
  return r.json();
}

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
    } catch {}
  };
  return () => es.close();
}
