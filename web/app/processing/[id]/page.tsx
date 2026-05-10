import { ProcessingScreen } from "@/components/ProcessingScreen";
import { API_BASE } from "@/lib/config";
import type { TrackSummary } from "@/lib/api";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

async function loadInitial(id: string): Promise<TrackSummary | null> {
  try {
    const r = await fetch(`${API_BASE}/tracks/${id}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as TrackSummary;
  } catch {
    return null;
  }
}

export default async function ProcessingPage({ params }: Props) {
  const { id } = await params;
  const initial = await loadInitial(id);
  return (
    <main className="flex-1 flex items-start justify-center py-10 px-4">
      <ProcessingScreen id={id} initial={initial} />
    </main>
  );
}
