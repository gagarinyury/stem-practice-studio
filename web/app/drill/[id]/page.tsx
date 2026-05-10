import { notFound } from "next/navigation";
import { DrillView } from "@/components/drill/DrillView";
import { loadAligned, loadManifest } from "@/lib/manifest.server";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ line?: string; from?: string; to?: string }>;
}

export default async function DrillPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const lineIndex = sp.line ? Number.parseInt(sp.line, 10) : undefined;
  const fromSec = sp.from ? Number.parseFloat(sp.from) : undefined;
  const toSec = sp.to ? Number.parseFloat(sp.to) : undefined;

  let manifest, aligned;
  try {
    manifest = await loadManifest(id);
    if (!manifest.aligned?.path) notFound();
    aligned = await loadAligned(id, manifest.aligned.path);
  } catch {
    notFound();
  }

  return (
    <main className="flex-1 flex items-start justify-center py-10 px-4">
      <DrillView
        manifest={manifest}
        aligned={aligned}
        initialLineIndex={lineIndex}
        initialFromSec={fromSec}
        initialToSec={toSec}
      />
    </main>
  );
}
