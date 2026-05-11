"use client";

import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";

const STORAGE_PREFIX = "local-video:";

export function isVideoFile(file: File): boolean {
  if (file.type && file.type.startsWith("video/")) return true;
  return /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name);
}

export function isNative(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

interface LocalVideoInfo {
  path: string;
  webPath: string;
  mime: string;
}

export async function readLocalVideoAsBlobUrl(path: string, mime: string): Promise<string> {
  const r = await Filesystem.readFile({ path, directory: Directory.Data });
  const base64 = typeof r.data === "string" ? r.data : await blobToBase64(r.data as Blob);
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  return URL.createObjectURL(blob);
}

async function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      const i = s.indexOf("base64,");
      resolve(i >= 0 ? s.slice(i + 7) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result as string;
      const idx = result.indexOf("base64,");
      resolve(idx >= 0 ? result.slice(idx + 7) : result);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export async function saveLocalVideo(trackId: string, file: File): Promise<LocalVideoInfo | null> {
  if (!isNative()) return null;
  const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
  const path = `tracks/${trackId}/source.${ext}`;
  const base64 = await fileToBase64(file);
  await Filesystem.writeFile({
    path,
    directory: Directory.Data,
    data: base64,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
  const webPath = Capacitor.convertFileSrc(uri);
  const mime = file.type || `video/${ext === "mov" ? "quicktime" : ext}`;
  const info: LocalVideoInfo = { path, webPath, mime };
  try { localStorage.setItem(STORAGE_PREFIX + trackId, JSON.stringify(info)); } catch {}
  return info;
}

export function getLocalVideo(trackId: string): LocalVideoInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + trackId);
    if (!raw) return null;
    return JSON.parse(raw) as LocalVideoInfo;
  } catch {
    return null;
  }
}

export async function deleteLocalVideo(trackId: string): Promise<void> {
  const info = getLocalVideo(trackId);
  if (info && isNative()) {
    try {
      await Filesystem.deleteFile({ path: info.path, directory: Directory.Data });
    } catch {}
  }
  try { localStorage.removeItem(STORAGE_PREFIX + trackId); } catch {}
}
