import { notFound } from "next/navigation";
import { SelectView } from "@/components/select/SelectView";
import { loadAligned, loadManifest } from "@/lib/manifest.server";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SelectPage({ params }: Props) {
  const { id } = await params;

  let manifest, aligned;
  try {
    manifest = await loadManifest(id);
    if (!manifest.aligned?.path) notFound();
    aligned = await loadAligned(id, manifest.aligned.path);
  } catch {
    notFound();
  }

  return <SelectView manifest={manifest} aligned={aligned} />;
}
