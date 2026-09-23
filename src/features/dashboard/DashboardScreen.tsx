import * as React from "react"
import { useNavigate } from "react-router"
import { Activity, Bot, Cpu, MessageSquare, Plus, Wallet, Zap, ArrowRight, ShieldCheck } from "lucide-react"
import { useRunsStore } from "@/stores/runs"
import { useAgentsStore } from "@/stores/agents"
import { useProvidersStore } from "@/stores/providers"
import { useActivityStore } from "@/stores/activity"
import { useMemoryStore } from "@/stores/memory"
import { useUiStore } from "@/stores/ui"
import { ActivityFeed, GlowCard, NeonButton, PageHeader, ProviderLogo, RepoCard, RunStatusBadge, SectionHeader, Stat, TacticalChip, ProgressBar, ModelTag } from "@/design-system"
import { formatUsd, formatRelative } from "@/lib/format"
import { cn } from "cn"

export function DashboardScreen() {
  const navigate = useNavigate()
  const runs = useRunsStore((s) => s.runs)
  const active = useRunsStore((s) => s.activeCount())
  const agents = useAgentsStore((s) => s.agents)
  const providers = useProvidersStore((s) => s.providers)
  const activity = useActivityStore((s) => s.items)
  const countForScope = useMemoryStore((s) => s.countForScope)
  const openNewSession = useUiStore((s) => s.openNewSession)
  const [dayAgo] = React.useState(() => Date.now() - 24 * 3600_000)
  const today = runs.filter((r) => r.createdAt > dayAgo)
  const cost = runs.reduce((n, r) => n + (r.actual?.costUsd ?? 0), 0)
  const online = providers.filter((p) => p.status === "connected" || p.status === "simulated").length

  return (
    <div className="mx-auto flex max-w-[1920px] flex-col gap-6 p-6 2xl:p-8">
      <PageHeader
        eyebrow="Command center"
        title="Every model, one console."
        description="Silent decomposes a prompt into subtasks, routes each one to the best model in your pool, executes through CLI integrations and reports back. Codex CLI is the execution core."
        actions={
          <>
            <NeonButton variant="outline" onClick={() => openNewSession({ kind: "standard" })}><MessageSquare />New chat</NeonButton>
            <NeonButton variant="outline" onClick={() => openNewSession({ kind: "repo-agent" })}><Bot />Create repo agent</NeonButton>
            <NeonButton onClick={() => navigate("/silent-code")}><Zap />Launch Silent Code</NeonButton>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Active AIs" value={active} hint={active ? "workers executing now" : "idle — launch a run"} icon={<Cpu />} tone={active ? "cyan" : "default"} />
        <Stat label="Runs · 24h" value={today.length} hint={`${runs.filter((r) => r.status === "completed").length} completed all-time`} icon={<Activity />} />
        <Stat label="Spend · all-time" value={formatUsd(cost)} hint="tracked from worker usage" icon={<Wallet />} tone="violet" />
        <Stat label="Providers online" value={`${online}/${providers.length}`} hint={providers.find((p) => p.id === "codex")?.status === "connected" ? "Codex CLI executing for real" : "Codex CLI not detected"} icon={<ShieldCheck />} tone={providers.find((p) => p.id === "codex")?.status === "connected" ? "success" : "warn"} />
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <section>
            <SectionHeader eyebrow="Silent Code" title="Recent sessions" actions={<button type="button" onClick={() => navigate("/runs")} className="flex items-center gap-1 text-xs text-text-2 hover:text-cyan">All sessions<ArrowRight className="size-3" /></button>} className="mb-3" />
            <div className="grid gap-3 md:grid-cols-2">
              {runs.slice(0, 4).map((r) => {
                const done = r.plan.filter((s) => s.state === "completed").length
                const pct = r.plan.length ? Math.round(r.plan.reduce((n, s) => n + s.progress, 0) / r.plan.length) : 0
                const models = Array.from(new Set(r.routing.map((x) => x.primaryModelId)))
                return (
                  <GlowCard key={r.id} interactive active={r.status === "running"} onClick={() => navigate(`/runs/${r.id}`)} className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-heading text-sm font-semibold">{r.title}</div>
                        <div className="truncate text-[11px] text-text-3">{r.repoPath ? r.repoPath.split("/").pop() : "no repo"} · {r.executionMode} · {formatRelative(r.createdAt)}</div>
                      </div>
                      <RunStatusBadge status={r.status} size="xs" />
                    </div>
                    <ProgressBar value={pct} active={r.status === "running"} tone={r.status === "failed" ? "danger" : r.status === "completed" ? "success" : "cyan"} />
                    <div className="flex items-center gap-2 text-[11px] text-text-3">
                      <span>{done}/{r.plan.length} subtasks</span>
                      <span className="ml-auto flex -space-x-1">{models.slice(0, 5).map((m) => <span key={m} className="rounded-full ring-2 ring-ink-1"><ModelTag modelId={m} size="xs" className="[&>span:last-child]:hidden" /></span>)}</span>
                      <span className="mono">{r.actual ? formatUsd(r.actual.costUsd) : `~${formatUsd(r.estimate.costUsd)}`}</span>
                    </div>
                  </GlowCard>
                )
              })}
              {runs.length === 0 && <GlowCard className="md:col-span-2 text-center text-xs text-text-3">No sessions yet. Launch Silent Code to orchestrate your first run.</GlowCard>}
            </div>
          </section>

          <section>
            <SectionHeader eyebrow="Repo agents" title="Specialised agents" actions={<button type="button" onClick={() => openNewSession({ kind: "repo-agent" })} className="flex items-center gap-1 text-xs text-text-2 hover:text-cyan"><Plus className="size-3" />Create</button>} className="mb-3" />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {agents.map((a) => <RepoCard key={a.id} agent={a} memoryCount={countForScope(a.id)} onOpen={() => navigate(`/agents/${a.id}`)} />)}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section>
            <SectionHeader eyebrow="Infrastructure" title="Provider health" actions={<button type="button" onClick={() => navigate("/settings")} className="text-xs text-text-2 hover:text-cyan">Manage</button>} className="mb-3" />
            <GlowCard padded={false} className="divide-y divide-line">
              {providers.map((p) => (
                <div key={p.id} className={cn("flex items-center gap-3 px-4 py-2.5", p.id === "codex" && "bg-cyan/[0.04]")}>
                  <ProviderLogo provider={p.id} size={14} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {p.name}
                      {p.id === "codex" && <TacticalChip size="xs" tone="cyan">core</TacticalChip>}
                    </div>
                    <div className="mono truncate text-[10px] text-text-3">{p.version ?? (p.kind === "cli" ? `${p.cliBinary} not found` : p.kind)}</div>
                  </div>
                  <TacticalChip size="xs" tone={p.status === "connected" ? "success" : p.status === "simulated" ? "violet" : p.status === "error" ? "danger" : "neutral"} dot>{p.status}</TacticalChip>
                </div>
              ))}
            </GlowCard>
          </section>
          <section>
            <SectionHeader eyebrow="Timeline" title="Recent activity" className="mb-3" />
            <GlowCard padded={false} className="px-2 py-1">
              <ActivityFeed items={activity} limit={10} onOpen={(it) => it.refRoute && navigate(it.refRoute)} />
            </GlowCard>
          </section>
        </div>
      </div>
    </div>
  )
}
