import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { SerifTitle } from "@/components/ui/SerifTitle";
import { MonoText } from "@/components/ui/MonoText";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { tokens } from "@/lib/design/tokens";

const colors: Array<[string, string]> = Object.entries(tokens.color);
const radii: Array<[string, string]> = Object.entries(tokens.radius);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <MonoLabel size="xs">{title}</MonoLabel>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function DesignCatalog() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-12">
        <SerifTitle size="xl" as="h1">Design Catalog</SerifTitle>
        <MonoText size="sm" tone="muted" className="mt-2 block">
          Stem Practice Studio — visual system reference
        </MonoText>
      </header>

      <Section title="colors">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {colors.map(([name, hex]) => (
            <Card key={name} className="overflow-hidden p-0">
              <div className="h-16 w-full" style={{ background: hex }} />
              <div className="px-3 py-2">
                <MonoText size="base">{name}</MonoText>
                <div><MonoText size="sm" tone="muted">{hex}</MonoText></div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="radius">
        <div className="flex flex-wrap gap-4">
          {radii.map(([name, value]) => (
            <Card key={name} className="px-4 py-3" radius={name === "lg" ? "lg" : "md"}>
              <MonoText size="base">{name}</MonoText>
              <div><MonoText size="sm" tone="muted">{value}</MonoText></div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="type ramp">
        <Card className="space-y-3 p-5">
          <SerifTitle size="xl">Title XL — 26 / serif</SerifTitle>
          <SerifTitle size="md">Title — 19 / serif</SerifTitle>
          <SerifTitle size="body">Body — 16 / serif</SerifTitle>
          <SerifTitle size="lyric">Lyric — 18 italic</SerifTitle>
          <div><MonoText size="base">monoBase — 13 / mono</MonoText></div>
          <div><MonoText size="sm" tone="muted">monoSm — 11 / mono muted</MonoText></div>
          <div><MonoLabel size="xs">monoXs uppercase 0.15em</MonoLabel></div>
          <div><MonoLabel size="micro">monoMicro uppercase 0.20em</MonoLabel></div>
        </Card>
      </Section>

      <Section title="screen primitives">
        <div className="space-y-3">
          <Card className="p-5">
            <ScreenHeader
              eyebrow="welcome back"
              title="Sign"
              emphasis="in."
              subtitle="email + password · no verification · no fuss"
            />
          </Card>
          <Card className="p-5">
            <ScreenHeader
              back="/design"
              eyebrow="finding your range"
              title="Now go"
              emphasis="up."
              subtitle="slide your voice up on 'ah' — stop the moment it strains"
            />
          </Card>
          <div className="flex items-center gap-3 pt-2">
            <Link href="/design/tour" className="font-mono text-[11px] text-[var(--color-accent-vocal)] underline">
              open screen tour →
            </Link>
            <Link href="/login" className="font-mono text-[11px] text-[var(--color-accent-vocal)] underline">
              see /login (reference) →
            </Link>
          </div>
        </div>
      </Section>

      <Section title="primitives — Card">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card className="p-4"><MonoText size="base">surface · radius md</MonoText></Card>
          <Card variant="muted" className="p-4"><MonoText size="base">muted · radius md</MonoText></Card>
          <Card radius="lg" className="p-4"><MonoText size="base">surface · radius lg</MonoText></Card>
          <Card bordered={false} variant="muted" className="p-4"><MonoText size="base">muted · borderless</MonoText></Card>
        </div>
      </Section>

      <Section title="primitives — Pill">
        <div className="flex flex-wrap gap-2">
          <Pill>×0.85</Pill>
          <Pill tone="muted">−2 st</Pill>
          <Pill tone="accent">vocals</Pill>
        </div>
      </Section>

      <Section title="primitives — MonoLabel">
        <div className="flex flex-col gap-2">
          <MonoLabel>continue</MonoLabel>
          <MonoLabel tone="plan">studio plan</MonoLabel>
          <MonoLabel tone="drill">drill mode</MonoLabel>
          <MonoLabel tone="warn">processing</MonoLabel>
          <MonoLabel size="micro" tone="ink" withDash={false}>NOW STUDYING</MonoLabel>
        </div>
      </Section>
    </main>
  );
}
