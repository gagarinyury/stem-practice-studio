/**
 * Client-side auth: token + user cached in localStorage. Backend is the source
 * of truth — we just stash the JWT and the user blob it returns.
 */
import { API_BASE } from "./config";

const TOKEN_KEY = "auth.token";
const USER_KEY = "auth.user";

export interface AuthUser {
  id: number;
  email: string;
  language: string;
  voice_low: string | null;
  voice_high: string | null;
  voice_type: string | null;
  streak_count: number;
  last_session_at: string | null;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return safeLocalStorage()?.getItem(TOKEN_KEY) ?? null;
}

export function getUser(): AuthUser | null {
  const raw = safeLocalStorage()?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setSession(resp: AuthResponse): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  ls.setItem(TOKEN_KEY, resp.access_token);
  ls.setItem(USER_KEY, JSON.stringify(resp.user));
}

export function setUser(user: AuthUser): void {
  safeLocalStorage()?.setItem(USER_KEY, JSON.stringify(user));
}

export function logout(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  ls.removeItem(TOKEN_KEY);
  ls.removeItem(USER_KEY);
}

async function authFetch(path: string, body: unknown): Promise<AuthResponse> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let detail = `${r.status}`;
    try {
      const j = await r.json();
      if (typeof j?.detail === "string") detail = j.detail;
    } catch {}
    throw new Error(detail);
  }
  return r.json();
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const resp = await authFetch("/auth/login", { email, password });
  setSession(resp);
  return resp.user;
}

export async function register(email: string, password: string): Promise<AuthUser> {
  const resp = await authFetch("/auth/register", { email, password });
  setSession(resp);
  return resp.user;
}

export function isAuthed(): boolean {
  return !!getToken();
}
