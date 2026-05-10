import { notFound } from "next/navigation";
import { MultiStemPlayer } from "@/components/player/MultiStemPlayer";
import { loadManifest, loadAligned } from "@/lib/manifest.server";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PlayerPage({ params }: Props) {
  const { id } = await params;
  let manifest, aligned;
  try {
    manifest = await loadManifest(id);
    aligned = await loadAligned(id, manifest.aligned.path);
  } catch {
    notFound();
  }

  return <MultiStemPlayer manifest={manifest} aligned={aligned} />;
}
