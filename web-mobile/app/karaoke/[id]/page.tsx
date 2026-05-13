import { notFound } from "next/navigation";
import { KaraokeView } from "@/components/karaoke/KaraokeView";
import { loadManifest, loadAligned } from "@/lib/manifest.server";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function KaraokePage({ params }: Props) {
  const { id } = await params;
  let manifest, aligned;
  try {
    manifest = await loadManifest(id);
    aligned = await loadAligned(id, manifest.aligned.path);
  } catch {
    notFound();
  }
  return <KaraokeView manifest={manifest} aligned={aligned} />;
}
