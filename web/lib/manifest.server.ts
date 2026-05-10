import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AlignedLyrics, Manifest } from "./manifest";

const RUNS_ROOT = path.join(process.cwd(), "public", "runs");

export async function loadManifest(id: string): Promise<Manifest> {
  const file = path.join(RUNS_ROOT, id, "manifest.json");
  const raw = await fs.readFile(file, "utf-8");
  const parsed = JSON.parse(raw) as Manifest;
  parsed.id = id;
  return parsed;
}

export async function loadAligned(id: string, relPath: string): Promise<AlignedLyrics> {
  const file = path.join(RUNS_ROOT, id, relPath);
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw) as AlignedLyrics;
}
