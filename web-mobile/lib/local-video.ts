"use client";

// Local video storage via IndexedDB. Keeps the original upload Blob
// in the WebView's own storage so karaoke can play it as a background
// without a server round-trip. Why IndexedDB and not @capacitor/filesystem:
// the Capacitor bridge serialises file contents as a base64 JSON string
// and shipping ~100 MB across the bridge crashes WKWebView's web content
// process. IndexedDB stores Blobs natively in-process — no copy, no IPC.
//
// Trade-off: iOS may evict IndexedDB if the device is low on disk
// (data is considered transient). Acceptable for MVP — if it's gone,
// karaoke just falls back to no-background.

const DB_NAME = "stem-practice";
const DB_VERSION = 1;
const STORE = "local-videos";

interface LocalVideoRecord {
  blob: Blob;
  mime: string;
}

function isVideoMimeOrName(file: File): boolean {
  if (file.type && file.type.startsWith("video/")) return true;
  return /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name);
}

export const isVideoFile = isVideoMimeOrName;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txPromise<T>(tx: IDBTransaction, value: T): Promise<T> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveLocalVideo(trackId: string, file: File): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const t0 = performance.now();
  console.log("[lv] save:start", { trackId, sizeMB: (file.size / 1048576).toFixed(1), mime: file.type });
  const db = openDb ? await openDb() : null;
  if (!db) return;
  const mime = file.type || "video/mp4";
  // Snapshot the File into a Blob so the IDB store keeps a stable copy
  // (some browsers detach the underlying File when the input changes).
  const blob = file.slice(0, file.size, mime);
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put({ blob, mime } satisfies LocalVideoRecord, trackId);
  await txPromise(tx, undefined);
  db.close();
  console.log("[lv] save:done", { ms: (performance.now() - t0).toFixed(0) });
}

export async function getLocalVideoBlobUrl(trackId: string): Promise<{ url: string; mime: string } | null> {
  if (typeof indexedDB === "undefined") return null;
  const t0 = performance.now();
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const req = tx.objectStore(STORE).get(trackId);
  const rec = await new Promise<LocalVideoRecord | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as LocalVideoRecord | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!rec) {
    console.log("[lv] read:miss", { trackId });
    return null;
  }
  const url = URL.createObjectURL(rec.blob);
  console.log("[lv] read:done", { ms: (performance.now() - t0).toFixed(0), sizeMB: (rec.blob.size / 1048576).toFixed(1), mime: rec.mime });
  return { url, mime: rec.mime };
}

export async function deleteLocalVideo(trackId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(trackId);
  await txPromise(tx, undefined);
  db.close();
}

export async function hasLocalVideo(trackId: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const req = tx.objectStore(STORE).getKey(trackId);
  const key = await new Promise<IDBValidKey | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return key !== undefined;
}
