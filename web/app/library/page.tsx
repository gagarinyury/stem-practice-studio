import { LibraryScreen } from "@/components/LibraryScreen";
import { API_BASE } from "@/lib/config";
import type { TrackSummary } from "@/lib/api";

export const dynamic = "force-dynamic";

async function loadTracks(): Promise<TrackSummary[]> {
  try {
    const r = await fetch(`${API_BASE}/tracks`, { cache: "no-store" });
    if (!r.ok) return [];
    return (await r.json()) as TrackSummary[];
  } catch {
    return [];
  }
}

export default async function LibraryPage() {
  const tracks = (await loadTracks()).slice().reverse();
  return (
    <main className="flex-1 flex items-start justify-center py-10 px-4">
      <LibraryScreen tracks={tracks} />
    </main>
  );
}
