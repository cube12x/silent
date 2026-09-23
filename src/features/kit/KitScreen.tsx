import { PROVIDERS, MODELS } from "@/engine/capabilities"
import { MOCK_RUNS } from "@/mocks"
import { GlowCard, TacticalChip, StatusBadge, NeonButton, ProgressBar, SectionHeader, ProviderLogo, ModelSelectorGrid, RouteGraph, ExecutionTimeline, Stat, CostMeter, PageHeader } from "@/design-system"
import type { WorkerState } from "@/domain"

const STATES: WorkerState[] = ["planning", "thinking", "coding", "testing", "reviewing", "waiting", "blocked", "completed", "failed"]

/** Dev-only gallery to eyeball the design system. */
export function KitScreen() {
  const run = MOCK_RUNS[0]
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-8 p-8">
      <PageHeader eyebrow="Dev" title="Design kit" description="Tokens, primitives and tactical components." />
      <section className="flex flex-col gap-3"><SectionHeader title="Logos" /><div className="flex gap-3">{PROVIDERS.map((p) => <ProviderLogo key={p.id} provider={p.id} size={22} />)}</div></section>
      <section className="flex flex-col gap-3"><SectionHeader title="Chips & badges" /><div className="flex flex-wrap gap-2">{STATES.map((s) => <StatusBadge key={s} state={s} />)}<TacticalChip tone="cyan" mono>codex exec --json</TacticalChip><TacticalChip tone="violet">frontier</TacticalChip></div></section>
      <section className="flex flex-col gap-3"><SectionHeader title="Buttons" /><div className="flex gap-2"><NeonButton>Primary</NeonButton><NeonButton variant="outline">Outline</NeonButton><NeonButton variant="ghost">Ghost</NeonButton><NeonButton variant="destructive">Destructive</NeonButton></div></section>
      <section className="flex flex-col gap-3"><SectionHeader title="Progress" /><ProgressBar value={35} active /><ProgressBar value={100} tone="success" /><ProgressBar value={60} tone="danger" /></section>
      <section className="grid grid-cols-4 gap-3"><Stat label="Active" value={3} tone="cyan" /><Stat label="Spend" value="$1.84" tone="violet" /><Stat label="Runs" value={12} /><Stat label="Providers" value="1/6" tone="warn" /></section>
      <section className="flex flex-col gap-3"><SectionHeader title="Cost meter" /><CostMeter tokens={61200} costUsd={1.84} seconds={420} /></section>
      <section className="flex flex-col gap-3"><SectionHeader title="Model selector" /><ModelSelectorGrid models={MODELS} providers={PROVIDERS} selected={["codex", "claude-opus"]} onToggle={() => {}} /></section>
      <section className="grid grid-cols-2 gap-4"><GlowCard><RouteGraph plan={run.plan} routing={run.routing} /></GlowCard><GlowCard><ExecutionTimeline plan={run.plan} /></GlowCard></section>
    </div>
  )
}
