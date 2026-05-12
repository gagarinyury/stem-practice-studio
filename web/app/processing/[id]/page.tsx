import { ProcessingScreen } from "@/components/ProcessingScreen";
import { API_BASE_SERVER as API_BASE } from "@/lib/config";
import type { TrackSummary } from "@/lib/api";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
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

export default async function ProcessingPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { preview } = await searchParams;
  const initial = await loadInitial(id);
  return <ProcessingScreen id={id} initial={initial} preview={preview === "1"} />;
}
