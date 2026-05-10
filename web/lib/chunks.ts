/**
 * Per-track learning chunks. Stored in localStorage as `chunks:${trackId}`.
 */

export interface Chunk {
  id: string;
  from: number;        // sec
  to: number;          // sec
  fromWordIdx: number; // index into aligned.words
  toWordIdx: number;
  label: string;       // human preview, first ~5 words
  mastered: boolean;
  attempts: number;
  createdAt: number;   // unix ms
}

const KEY = (trackId: string) => `chunks:${trackId}`;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function listChunks(trackId: string): Chunk[] {
  if (typeof window === "undefined") return [];
  return safeParse<Chunk[]>(window.localStorage.getItem(KEY(trackId)), []);
}

export function saveChunk(trackId: string, chunk: Omit<Chunk, "id" | "createdAt" | "attempts" | "mastered">): Chunk {
  const full: Chunk = {
    ...chunk,
    id: cryptoId(),
    createdAt: Date.now(),
    attempts: 0,
    mastered: false,
  };
  const cur = listChunks(trackId);
  cur.push(full);
  window.localStorage.setItem(KEY(trackId), JSON.stringify(cur));
  return full;
}

export function updateChunk(trackId: string, chunkId: string, patch: Partial<Chunk>): void {
  const cur = listChunks(trackId);
  const idx = cur.findIndex((c) => c.id === chunkId);
  if (idx === -1) return;
  cur[idx] = { ...cur[idx], ...patch };
  window.localStorage.setItem(KEY(trackId), JSON.stringify(cur));
}

export function deleteChunk(trackId: string, chunkId: string): void {
  const cur = listChunks(trackId).filter((c) => c.id !== chunkId);
  window.localStorage.setItem(KEY(trackId), JSON.stringify(cur));
}

function cryptoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}
