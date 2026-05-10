import Link from "next/link";
import { SerifTitle } from "@/components/ui/SerifTitle";
import { MonoText } from "@/components/ui/MonoText";
import { MonoLabel } from "@/components/ui/MonoLabel";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <MonoLabel size="micro" tone="ink" withDash={false}>STEM PRACTICE STUDIO</MonoLabel>
      <SerifTitle size="xl" as="h1" className="mt-3">Phase 3.0 scaffold</SerifTitle>
      <MonoText size="sm" tone="muted" className="mt-2 block">
        Design system catalog → <Link href="/design" className="underline">/design</Link>
      </MonoText>
    </main>
  );
}
