import * as React from "react"
import { useNavigate, useSearchParams } from "react-router"
import { cn } from "cn"
import { Bot, FolderGit2, Layers, Play, Route, Sparkles, Wallet, Workflow, Zap } from "lucide-react"
import { useProvidersStore } from "@/stores/providers"
import { useAgentsStore } from "@/stores/agents"
import { useSettingsStore } from "@/stores/settings"
import { useRunsStore } from "@/stores/runs"
import { CostMeter, GlowCard, ModelSelectorGrid, ModelTag, NeonButton, PageHeader, RouteGraph, SectionHeader, TacticalChip, KIND_LABEL } from "@/design-system"
import { COST_MODES, COST_MODE_LABELS, type CostMode, type ExecutionMode, type SilentCodeRun } from "@/domain"
import { MODELS } from "@/engine/capabilities"
import { Textarea } from "@/components/ui/textarea"

const EXEC_MODES: { id: ExecutionMode; label: string; desc: string }[] = [
  { id: "staged", label: "Staged", desc: "Parallel within dependency stages (recommended)" },
  { id: "parallel", label: "Parallel", desc: "Max concurrency; fastest wall-clock" },
  { id: "sequential", label: "Sequential", desc: "One worker at a time; cheapest, easiest to audit" },
]

const EXAMPLES = [
  "Add a real-time notification system to the Reach repository.",
  "Optimise the diffusion step algorithm in the simulation engine for performance, add benchmarks and tests.",
  "Build an admin dashboard page with an API endpoint for audit logs, plus docs.",
]

export function SilentCodeScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const providers = useProvidersStore((s) => s.providers)
  const enabledModels = React.useMemo(() => {
    const on = new Set(providers.filter((p) => p.enabled).map((p) => p.id))
    return MODELS.filter((m) => on.has(m.providerId))
  }, [providers])
  const agents = useAgentsStore((s) => s.agents)
  const settings = useSettingsStore((s) => s.settings)
  const draft = useRunsStore((s) => s.draft)
  const start = useRunsStore((s) => s.start)

  const [prompt, setPrompt] = React.useState("")
  const [rawPool, setPool] = React.useState<string[] | null>(null)
  const pool = React.useMemo(() => (rawPool ?? enabledModels.map((m) => m.id)).filter((id) => enabledModels.some((m) => m.id === id)), [rawPool, enabledModels])
  const [mode, setMode] = React.useState<ExecutionMode>("staged")
  const [costMode, setCostMode] = React.useState<CostMode>(settings.costMode)
  const [agentId, setAgentId] = React.useState<string | undefined>(params.get("agent") ?? undefined)
  const [starting, setStarting] = React.useState(false)


  const preview: SilentCodeRun | null = React.useMemo(() => (prompt.trim().length > 8 && pool.length ? draft({ prompt, pool, executionMode: mode, costMode, repoAgentId: agentId }) : null), [prompt, pool, mode, costMode, agentId, draft])
  const unrouted = preview?.routing.filter((r) => !r.primaryModelId).length ?? 0
  const agent = agents.find((a) => a.id === agentId)

  const launch = async () => {
    if (!preview || unrouted) return
    setStarting(true)
    await start(preview)
    navigate(`/runs/${preview.id}`)
  }

  return (
    <div className="mx-auto flex max-w-[1920px] flex-col gap-6 p-6 2xl:p-8">
      <PageHeader eyebrow="Silent Code · flagship" title="One prompt. An army of models." description="Describe the outcome. Silent plans the subtasks, routes each to the best model in your pool, executes through the CLI layer and monitors everything live." actions={<TacticalChip tone="violet"><Sparkles className="size-3" />orchestration</TacticalChip>} />

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <GlowCard tone="cyan" className="flex flex-col gap-3 p-0">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[10px] font-semibold tracking-[0.18em] text-cyan uppercase">
              <Zap className="size-3" />Mission prompt
              <span className="ml-auto flex items-center gap-2 normal-case tracking-normal text-text-3">
                <Bot className="size-3" />
                <select value={agentId ?? ""} onChange={(e) => setAgentId(e.target.value || undefined)} className="rounded-md border border-line bg-ink-2 px-1.5 py-0.5 text-[11px] text-text-1 outline-none focus:border-cyan/50">
                  <option value="">No repo agent</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </span>
            </div>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} placeholder={EXAMPLES[0]} className="mono min-h-[160px] resize-y border-0 bg-transparent px-4 text-[15px] leading-7 shadow-none focus-visible:ring-0" />
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
              {agent ? <span className="mono flex items-center gap-1 text-[11px] text-text-2"><FolderGit2 className="size-3" />{agent.repoPath}</span> : <span className="text-[11px] text-text-3">No repository bound — workers plan without repo context.</span>}
              <span className="ml-auto flex gap-1.5">{EXAMPLES.map((ex, i) => <button key={i} type="button" onClick={() => setPrompt(ex)} className="rounded-md border border-line px-2 py-0.5 text-[10px] text-text-3 hover:border-cyan/50 hover:text-cyan">example {i + 1}</button>)}</span>
            </div>
          </GlowCard>

          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="Model pool" title="Enabled models" description="Routing only chooses from checked models. Codex executes for real; the rest are simulated until wired." actions={<div className="flex gap-1"><button type="button" onClick={() => setPool(enabledModels.map((m) => m.id))} className="text-xs text-text-2 hover:text-cyan">all</button><span className="text-text-3">·</span><button type="button" onClick={() => setPool([])} className="text-xs text-text-2 hover:text-cyan">none</button></div>} />
            <ModelSelectorGrid models={enabledModels} providers={providers} selected={pool} onToggle={(id) => setPool(pool.includes(id) ? pool.filter((x) => x !== id) : [...pool, id])} />
          </GlowCard>

          <div className="grid gap-4 md:grid-cols-2">
            <GlowCard className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase"><Workflow className="size-3" />Execution mode</div>
              {EXEC_MODES.map((m) => (
                <button key={m.id} type="button" onClick={() => setMode(m.id)} className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors", mode === m.id ? "border-cyan/50 bg-cyan/[0.06]" : "border-line hover:border-line-strong")}>
                  <span><span className="block text-sm font-medium">{m.label}</span><span className="block text-[11px] text-text-3">{m.desc}</span></span>
                  <span className={cn("size-2 rounded-full", mode === m.id ? "bg-cyan" : "bg-line-strong")} />
                </button>
              ))}
            </GlowCard>
            <GlowCard className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase"><Wallet className="size-3" />Cost mode</div>
              <div className="grid grid-cols-1 gap-1.5">
                {COST_MODES.map((c) => (
                  <button key={c} type="button" onClick={() => setCostMode(c)} className={cn("flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm transition-colors", costMode === c ? "border-violet/50 bg-violet/[0.08]" : "border-line hover:border-line-strong")}>
                    {COST_MODE_LABELS[c]}
                    <span className={cn("size-2 rounded-full", costMode === c ? "bg-violet" : "bg-line-strong")} />
                  </button>
                ))}
              </div>
            </GlowCard>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <GlowCard tone={preview ? "violet" : "default"} className="flex flex-col gap-4">
            <SectionHeader eyebrow="Orchestration preview" title={preview ? preview.title : "Waiting for a prompt"} description={preview ? `${preview.plan.length} subtasks · ${new Set(preview.routing.map((r) => r.primaryModelId).filter(Boolean)).size} models · ${mode}` : "Type a mission to see the plan, routing and estimate update live."} />
            {preview ? (
              <>
                <RouteGraph plan={preview.plan} routing={preview.routing} />
                <CostMeter tokens={preview.estimate.tokens} costUsd={preview.estimate.costUsd} seconds={preview.estimate.seconds} />
                <div>
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase"><Route className="size-3" />Routing decisions</div>
                  <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                    {preview.plan.map((s) => {
                      const r = preview.routing.find((x) => x.subtaskId === s.id)!
                      return (
                        <li key={s.id} className="flex items-start gap-3 px-3 py-2">
                          <span className="w-24 shrink-0 pt-0.5 text-xs font-medium">{KIND_LABEL[s.kind]}</span>
                          <span className="text-text-3">→</span>
                          <span className="min-w-0 flex-1">
                            {r.primaryModelId ? <ModelTag modelId={r.primaryModelId} size="xs" /> : <span className="text-xs text-danger">unrouted</span>}
                            <span className="block text-[11px] text-text-3">{r.reason}</span>
                            {r.fallbackModelIds.length > 0 && <span className="mt-0.5 flex items-center gap-1 text-[10px] text-text-3">fallback: {r.fallbackModelIds.map((f) => <ModelTag key={f} modelId={f} size="xs" className="text-text-3" />)}</span>}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line-strong/70 p-6 text-center text-xs text-text-3">
                <Layers className="mx-auto size-5 text-text-3" />
                Task → Model graph, cost estimate and fallback chains appear here.
              </div>
            )}
            <NeonButton size="lg" disabled={!preview || unrouted > 0 || starting} onClick={launch} className="h-11 w-full text-base">
              <Play />
              {starting ? "Launching…" : unrouted ? `${unrouted} subtask${unrouted > 1 ? "s" : ""} unrouted — adjust pool or cost mode` : "Start orchestration"}
            </NeonButton>
          </GlowCard>
        </div>
      </div>
    </div>
  )
}
