import * as React from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"
import { cn } from "cn"
import { Bot, FolderGit2, FolderOpen, Play, Route, Square, Workflow, Zap, RotateCcw, Wallet } from "lucide-react"
import { useProvidersStore, selectAvailableModels } from "@/stores/providers"
import { useAgentsStore } from "@/stores/agents"
import { useSettingsStore } from "@/stores/settings"
import { useRunsStore } from "@/stores/runs"
import { useUiStore } from "@/stores/ui"
import { AgentWorkerCard, CostMeter, GlowCard, ModelSelectorGrid, ModelTag, NeonButton, PageHeader, ProgressBar, RouteGraph, RunStatusBadge, SectionHeader, TacticalChip, ExecutionTimeline } from "@/design-system"
import { COST_MODES, modelRef, type CostMode, type ExecutionMode, type SilentCodeRun, type SubtaskKind, type WorkerState, type RunStatus } from "@/domain"
import { Textarea } from "@/components/ui/textarea"
import { getBackend } from "@/services"
import { formatDuration } from "@/lib/format"
import { useT } from "@/i18n"
import { PlanEditor, type PlanEdit } from "./PlanEditor"
import { excludedKinds } from "@/engine/planner"

const KINDS: SubtaskKind[] = ["architecture", "backend", "frontend", "algorithm", "tests", "review", "integration", "docs"]
const STATES: WorkerState[] = ["planning", "thinking", "coding", "testing", "reviewing", "waiting", "blocked", "completed", "failed"]
const RUN_STATUSES: RunStatus[] = ["draft", "planned", "running", "completed", "failed", "cancelled"]

function useLabels() {
  const t = useT()
  const kinds = Object.fromEntries(KINDS.map((k) => [k, t(`code.kinds.${k}` as const)])) as Record<SubtaskKind, string>
  const states = Object.fromEntries(STATES.map((s) => [s, t(`code.states.${s}` as const)])) as Record<WorkerState, string>
  const runStatus = Object.fromEntries(RUN_STATUSES.map((s) => [s, t(`code.runStatus.${s}` as const)])) as Record<RunStatus, string>
  return { kinds, states, runStatus }
}

/** Composer: prompt + pool + mode → live plan → start. */
function Composer() {
  const t = useT()
  const labels = useLabels()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const providers = useProvidersStore((s) => s.providers)
  const models = React.useMemo(() => selectAvailableModels(providers), [providers])
  const modelLabels = React.useMemo(() => Object.fromEntries(models.map((m) => [modelRef(m.providerId, m.id), m.displayName])), [models])
  const agents = useAgentsStore((s) => s.agents)
  const settings = useSettingsStore((s) => s.settings)
  const draft = useRunsStore((s) => s.draft)
  const start = useRunsStore((s) => s.start)
  const [prompt, setPrompt] = React.useState("")
  const [rawPool, setPool] = React.useState<string[] | null>(null)
  const pool = React.useMemo(() => (rawPool ?? models.filter((m) => m.isDefault || m.tier !== "fast").map((m) => modelRef(m.providerId, m.id))).filter((ref) => modelLabels[ref]), [rawPool, models, modelLabels])
  const [mode, setMode] = React.useState<ExecutionMode>("staged")
  const [costMode, setCostMode] = React.useState<CostMode>(settings.costMode)
  const [agentId, setAgentId] = React.useState<string | undefined>(params.get("agent") ?? undefined)
  const [folder, setFolder] = React.useState<string | undefined>()
  const [starting, setStarting] = React.useState(false)
  const [manual, setManual] = React.useState(false)
  const [edit, setEdit] = React.useState<PlanEdit | null>(null)
  const agent = agents.find((a) => a.id === agentId)
  const repoPath = agent?.repoPath ?? folder
  const autoPreview: SilentCodeRun | null = React.useMemo(() => (prompt.trim().length > 8 && pool.length ? draft({ prompt, pool, executionMode: mode, costMode, repoAgentId: agentId, repoPath }) : null), [prompt, pool, mode, costMode, agentId, repoPath, draft])
  // Manual edits are keyed to the auto plan they started from; a new prompt/pool resets them.
  const editKey = autoPreview ? `${autoPreview.plan.map((s) => s.kind).join(",")}|${pool.join(",")}|${costMode}` : ""
  const [editFor, setEditFor] = React.useState("")
  const preview: SilentCodeRun | null = autoPreview && edit && editFor === editKey ? { ...autoPreview, plan: edit.plan.map((s) => ({ ...s, runId: autoPreview.id })), routing: edit.routing, manual } : autoPreview
  const applyEdit = (e: PlanEdit) => {
    setEdit(e)
    setEditFor(editKey)
    setManual(true)
  }
  const unrouted = preview?.routing.filter((r) => !r.primaryModelId).length ?? 0
  const excluded = Array.from(excludedKinds(prompt))

  const pickFolder = async () => {
    const backend = await getBackend()
    const p = await backend.pickDirectory()
    if (p) {
      setFolder(p)
      setAgentId(undefined)
    }
  }
  const launch = async () => {
    if (!preview || unrouted) return
    setStarting(true)
    await start(preview)
    navigate(`/code/${preview.id}`)
  }

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 p-6">
      <PageHeader eyebrow={t("code.title")} title={t("code.subtitle")} description={t("code.description")} />
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <GlowCard tone="cyan" className="flex flex-col gap-0 p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-[10px] font-semibold tracking-[0.18em] text-cyan uppercase">
              <Zap className="size-3" />{t("code.prompt")}
              <span className="ml-auto flex items-center gap-2 normal-case tracking-normal">
                <Bot className="size-3 text-text-3" />
                <select value={agentId ?? ""} onChange={(e) => { setAgentId(e.target.value || undefined); if (e.target.value) setFolder(undefined) }} className="rounded-md border border-line bg-ink-2 px-1.5 py-0.5 text-[11px] text-text-1 outline-none focus:border-cyan/50">
                  <option value="">{t("code.noAgent")}</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {!agent && <button type="button" onClick={pickFolder} className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-text-2 hover:border-cyan/50 hover:text-cyan"><FolderOpen className="size-3" />{t("common.browse")}</button>}
              </span>
            </div>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} placeholder={t("code.promptPlaceholder")} className="mono min-h-[150px] resize-y border-0 bg-transparent px-4 text-[15px] leading-7 shadow-none focus-visible:ring-0" />
            <div className="border-t border-line px-4 py-2 text-[11px] text-text-3">{repoPath ? <span className="mono flex items-center gap-1 text-text-2"><FolderGit2 className="size-3" />{repoPath}</span> : t("code.noAgent")}</div>
          </GlowCard>

          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow={t("code.pool")} title={`${pool.length} / ${models.length}`} description={models.length ? t("code.poolHint") : t("code.poolEmpty")} actions={<div className="flex gap-1 text-xs"><button type="button" onClick={() => setPool(models.map((m) => modelRef(m.providerId, m.id)))} className="text-text-2 hover:text-cyan">{t("code.all")}</button><span className="text-text-3">·</span><button type="button" onClick={() => setPool([])} className="text-text-2 hover:text-cyan">{t("code.noneSel")}</button></div>} />
            <ModelSelectorGrid models={models} selected={pool} onToggle={(ref) => setPool(pool.includes(ref) ? pool.filter((x) => x !== ref) : [...pool, ref])} />
          </GlowCard>

          <div className="grid gap-4 md:grid-cols-2">
            <GlowCard className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase"><Workflow className="size-3" />{t("code.mode")}</div>
              {(["staged", "parallel", "sequential"] as ExecutionMode[]).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-left", mode === m ? "border-cyan/50 bg-cyan/[0.06]" : "border-line hover:border-line-strong")}>
                  <span><span className="block text-sm font-medium">{t(`code.modes.${m}` as const)}</span><span className="block text-[11px] text-text-3">{t(`code.modeHints.${m}` as const)}</span></span>
                  <span className={cn("size-2 rounded-full", mode === m ? "bg-cyan" : "bg-line-strong")} />
                </button>
              ))}
            </GlowCard>
            <GlowCard className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase"><Wallet className="size-3" />{t("code.cost")}</div>
              {COST_MODES.map((c) => (
                <button key={c} type="button" onClick={() => setCostMode(c)} className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-sm", costMode === c ? "border-violet/50 bg-violet/[0.08]" : "border-line hover:border-line-strong")}>
                  {t(`code.costModes.${c}` as const)}
                  <span className={cn("size-2 rounded-full", costMode === c ? "bg-violet" : "bg-line-strong")} />
                </button>
              ))}
            </GlowCard>
          </div>
        </div>

        <GlowCard tone={preview ? "violet" : "default"} className="flex h-fit flex-col gap-4">
          <SectionHeader eyebrow={t("code.preview")} title={preview ? preview.title : t("code.previewEmpty")} description={preview ? `${t("code.subtasks", { n: preview.plan.length })} · ${t("code.modelsCount", { n: new Set(preview.routing.map((r) => r.primaryModelId).filter(Boolean)).size })} · ${t(`code.modes.${mode}` as const)}` : undefined} />
          {preview && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">{t("code.planEditor")}</span>
                <div className="ml-auto flex rounded-sm border border-line text-[11px]">
                  <button type="button" onClick={() => { setManual(false); setEdit(null) }} className={cn("px-2 py-0.5", !manual ? "bg-text-1 text-black" : "text-text-2")}>{t("code.auto")}</button>
                  <button type="button" onClick={() => { setManual(true); if (!edit || editFor !== editKey) { setEdit({ plan: preview.plan, routing: preview.routing }); setEditFor(editKey) } }} className={cn("px-2 py-0.5", manual ? "bg-text-1 text-black" : "text-text-2")}>{t("code.manual")}</button>
                </div>
              </div>
              <div className="text-[11px] text-text-3">{manual ? t("code.manualHint") : t("code.autoHint")}{excluded.length ? ` · ${t("code.excluded", { kinds: excluded.map((k) => labels.kinds[k]).join(", ") })}` : ""}</div>
              <PlanEditor plan={preview.plan} routing={preview.routing} models={models} pool={pool} costMode={costMode} manual={manual} onChange={applyEdit} kindLabels={labels.kinds} />
              <RouteGraph plan={preview.plan} routing={preview.routing} labels={modelLabels} kindLabels={labels.kinds} />
              <CostMeter tokens={preview.estimate.tokens} seconds={preview.estimate.seconds} labels={{ tokens: t("code.tokens"), time: t("code.time"), cost: t("code.costUsd"), estimate: t("code.estimate") }} />
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase"><Route className="size-3" />{t("code.routing")}</div>
                <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                  {preview.plan.map((s) => {
                    const r = preview.routing.find((x) => x.subtaskId === s.id)!
                    return (
                      <li key={s.id} className="flex items-start gap-3 px-3 py-2">
                        <span className="w-24 shrink-0 pt-0.5 text-xs font-medium">{labels.kinds[s.kind]}</span>
                        <span className="text-text-3">→</span>
                        <span className="min-w-0 flex-1">
                          {r.primaryModelId ? <ModelTag modelRef={r.primaryModelId} label={modelLabels[r.primaryModelId]} size="xs" /> : <span className="text-xs text-danger">{t("code.unrouted")}</span>}
                          {r.fallbackModelIds.length > 0 && <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-text-3">{t("code.fallback")}: {r.fallbackModelIds.map((f) => <ModelTag key={f} modelRef={f} label={modelLabels[f]} size="xs" className="text-text-3" />)}</span>}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </>
          )}
          <NeonButton size="lg" disabled={!preview || unrouted > 0 || starting} onClick={launch} className="h-11 w-full text-base"><Play />{starting ? t("code.starting") : unrouted ? t("code.unroutedHint", { n: unrouted }) : t("code.startRun")}</NeonButton>
        </GlowCard>
      </div>
    </div>
  )
}

/** Live view of one run: progress, worker cards, graph, timeline. */
function RunView({ runId }: { runId: string }) {
  const t = useT()
  const labels = useLabels()
  const navigate = useNavigate()
  const run = useRunsStore((s) => s.byId(runId))
  const usage = useRunsStore((s) => s.usage[runId])
  const cancel = useRunsStore((s) => s.cancel)
  const draft = useRunsStore((s) => s.draft)
  const start = useRunsStore((s) => s.start)
  const openDrawer = useUiStore((s) => s.openDrawer)
  const drawer = useUiStore((s) => s.drawer)
  const providers = useProvidersStore((s) => s.providers)
  const modelLabels = React.useMemo(() => Object.fromEntries(selectAvailableModels(providers).map((m) => [modelRef(m.providerId, m.id), m.displayName])), [providers])
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])
  if (!run) return <div className="p-6"><NeonButton onClick={() => navigate("/code")}>{t("code.newRun")}</NeonButton></div>
  const pct = run.plan.length ? Math.round(run.plan.reduce((n, s) => n + s.progress, 0) / run.plan.length) : 0
  const done = run.plan.filter((s) => s.state === "completed").length
  const failed = run.plan.filter((s) => s.state === "failed").length
  const active = Array.from(new Set(run.plan.filter((s) => ["planning", "thinking", "coding", "testing", "reviewing"].includes(s.state)).map((s) => s.assignedModelId).filter(Boolean))) as string[]
  const elapsed = run.startedAt ? (run.finishedAt ?? now) - run.startedAt : 0
  const rerun = async () => {
    const d = draft({ prompt: run.prompt, pool: run.modelPool, executionMode: run.executionMode, costMode: run.costMode, repoAgentId: run.repoAgentId, repoPath: run.repoPath })
    await start(d)
    navigate(`/code/${d.id}`)
  }
  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 p-6">
      <PageHeader
        eyebrow={t("code.title")}
        title={<span className="flex items-center gap-3">{run.title}<RunStatusBadge status={run.status} label={labels.runStatus[run.status]} /></span>}
        description={<span className="flex flex-wrap items-center gap-3 text-xs"><span className="mono text-text-2">“{run.prompt.length > 160 ? run.prompt.slice(0, 157) + "…" : run.prompt}”</span>{run.repoPath && <span className="mono flex items-center gap-1"><FolderGit2 className="size-3" />{run.repoPath}</span>}</span>}
        actions={run.status === "running" ? <NeonButton variant="outline" onClick={() => cancel(run.id)} className="border-danger/40 text-danger hover:border-danger hover:text-danger"><Square />{t("code.cancelRun")}</NeonButton> : <><NeonButton variant="outline" onClick={rerun}><RotateCcw />{t("code.rerun")}</NeonButton><NeonButton onClick={() => navigate("/code")}><Zap />{t("code.newRun")}</NeonButton></>}
      />
      <GlowCard tone={run.status === "running" ? "cyan" : run.status === "failed" ? "danger" : run.status === "completed" ? "success" : "default"} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="font-heading text-3xl font-semibold tabular-nums">{pct}%</div>
          <div className="text-xs text-text-2">
            <div>{t("code.complete", { done, total: run.plan.length })}{failed ? <span className="text-danger"> · {t("code.failedN", { n: failed })}</span> : null}</div>
            <div className="text-text-3">{t(`code.modes.${run.executionMode}` as const)} · {t(`code.costModes.${run.costMode}` as const)}{elapsed ? ` · ${formatDuration(elapsed)} ${t("code.elapsed")}` : ""}{run.status === "cancelled" && !run.finishedAt ? ` · ${t("code.interrupted")}` : ""}</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-[10px] tracking-[0.16em] text-text-3 uppercase">{t("code.activeModels")}</span>
            {active.length ? active.map((m) => <TacticalChip key={m} tone="cyan" dot pulse><ModelTag modelRef={m} label={modelLabels[m]} size="xs" className="text-cyan" /></TacticalChip>) : <TacticalChip>{t("common.none")}</TacticalChip>}
          </div>
        </div>
        <ProgressBar value={pct} active={run.status === "running"} size="lg" tone={run.status === "failed" ? "danger" : run.status === "completed" ? "success" : "cyan"} />
      </GlowCard>
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <section>
            <SectionHeader eyebrow={t("code.workers")} title={t("code.workersHint")} className="mb-3" />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{run.plan.map((s) => <AgentWorkerCard key={s.id} subtask={s} now={now} selected={drawer?.subtaskId === s.id} kindLabel={labels.kinds[s.kind]} stateLabel={labels.states[s.state]} onOpen={() => openDrawer(run.id, s.id)} />)}</div>
          </section>
          <GlowCard><RouteGraph plan={run.plan} routing={run.routing} labels={modelLabels} kindLabels={labels.kinds} onSelectSubtask={(id) => openDrawer(run.id, id)} selectedSubtaskId={drawer?.subtaskId} /></GlowCard>
        </div>
        <div className="flex flex-col gap-5">
          <GlowCard className="flex flex-col gap-3">
            <CostMeter tokens={run.estimate.tokens} seconds={run.estimate.seconds} actual={run.actual ?? (usage && usage.tokens ? { tokens: usage.tokens, costUsd: usage.costUsd } : undefined)} labels={{ tokens: t("code.tokens"), time: t("code.time"), cost: t("code.costUsd"), estimate: t("code.estimate") }} />
          </GlowCard>
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow={t("code.progress")} title={t("code.history")} />
            <ExecutionTimeline plan={run.plan} selectedId={drawer?.subtaskId} onSelect={(id) => openDrawer(run.id, id)} kindLabels={labels.kinds} stateLabels={labels.states} />
          </GlowCard>
        </div>
      </div>
    </div>
  )
}

export function SilentCodeScreen() {
  const { runId } = useParams()
  return runId ? <RunView runId={runId} /> : <Composer />
}
