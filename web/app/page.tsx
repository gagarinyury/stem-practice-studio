import { ImportScreen } from "@/components/ImportScreen";
import { API_BASE } from "@/lib/config";
import type { TrackSummary } from "@/lib/api";

export const dynamic = "force-dynamic";

async function loadRecents() {
  try {
    const r = await fetch(`${API_BASE}/tracks`, { cache: "no-store" });
    if (!r.ok) return [];
    const tracks = (await r.json()) as TrackSummary[];
    return tracks
      .filter((t) => t.status === "done")
      .slice(-3)
      .reverse()
      .map((t) => ({
        id: t.id,
        title: t.title,
        meta: [t.artist, t.duration ? `${Math.round(t.duration / 60)}:${String(Math.round(t.duration % 60)).padStart(2, "0")}` : null]
          .filter(Boolean)
          .join(" · "),
      }));
  } catch {
    return [];
  }
}

export default async function Home() {
  const recents = await loadRecents();
  return (
    <main className="flex-1 flex items-start justify-center py-10 px-4">
      <ImportScreen recents={recents} />
    </main>
  );
}
