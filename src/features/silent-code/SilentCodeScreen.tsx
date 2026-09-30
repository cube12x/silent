import * as React from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"
import { cn } from "cn"
import { AlertTriangle, Bot, Check, FolderGit2, FolderOpen, MessageSquare, Play, Route, Sparkles, Square, Workflow, Zap, RotateCcw, Wallet, GitBranch, Loader2, Trash2 } from "lucide-react"
import { useProvidersStore, selectAvailableModels } from "@/stores/providers"
import { useAgentsStore } from "@/stores/agents"
import { useSettingsStore } from "@/stores/settings"
import { useRunsStore, type PlanResult } from "@/stores/runs"
import { useChatsStore } from "@/stores/chats"
import { useUiStore } from "@/stores/ui"
import { AgentWorkerCard, CostMeter, GlowCard, ModelSelectorGrid, ModelTag, NeonButton, PageHeader, ProgressBar, RouteGraph, RunStatusBadge, SectionHeader, TacticalChip, ExecutionTimeline } from "@/design-system"
import { COST_MODES, modelRef, type CostMode, type ExecutionMode, type SilentCodeRun, type SubtaskKind, type WorkerState, type RunStatus } from "@/domain"
import { Textarea } from "@/components/ui/textarea"
import { getBackend } from "@/services"
import { BUILTIN_KITS, detectKit, kitById } from "@/domain/kits"
import { formatDuration } from "@/lib/format"
import { useI18nStore, useT } from "@/i18n"
import { PlanEditor, type PlanEdit } from "./PlanEditor"
import { QuestionCard } from "./QuestionCard"
import { RunReport } from "./RunReport"

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

type Step = "task" | "plan" | "start"

/** Composer: Task → Plan (AI questions + editor + approve) → Start. */
function Composer() {
  const t = useT()
  const lang = useI18nStore((st) => st.language)
  const labels = useLabels()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const providers = useProvidersStore((s) => s.providers)
  const unavailable = useProvidersStore((s) => s.unavailable)
  const models = React.useMemo(() => selectAvailableModels(providers, unavailable), [providers, unavailable])
  const modelLabels = React.useMemo(() => Object.fromEntries(models.map((m) => [modelRef(m.providerId, m.id), m.displayName])), [models])
  const agents = useAgentsStore((s) => s.agents)
  const settings = useSettingsStore((s) => s.settings)
  const planWithAi = useRunsStore((s) => s.plan)
  const planning = useRunsStore((s) => s.planning)
  const start = useRunsStore((s) => s.start)
  const parent = useRunsStore((s) => s.byId(params.get("continue") ?? undefined))
  const autostart = useRunsStore((s) => s.autostart)

  const [prompt, setPrompt] = React.useState("")
  const [rawPool, setPool] = React.useState<string[] | null>(null)
  const pool = React.useMemo(() => (rawPool ?? models.map((m) => modelRef(m.providerId, m.id))).filter((ref) => modelLabels[ref]), [rawPool, models, modelLabels])
  const [mode, setMode] = React.useState<ExecutionMode>("staged")
  const [costMode, setCostMode] = React.useState<CostMode>(settings.costMode)
  const [agentId, setAgentId] = React.useState<string | undefined>(params.get("agent") ?? parent?.repoAgentId ?? undefined)
  const [folder, setFolder] = React.useState<string | undefined>(parent?.repoPath)
  const [step, setStep] = React.useState<Step>("task")
  const [result, setResult] = React.useState<PlanResult | null>(null)
  const [answers, setAnswers] = React.useState<Record<string, string>>({})
  const [edit, setEdit] = React.useState<PlanEdit | null>(null)
  const [manual, setManual] = React.useState(false)
  const [approved, setApproved] = React.useState(false)
  const [starting, setStarting] = React.useState(false)
  const [uiError, setUiError] = React.useState<string | null>(null)
  const [newName, setNewName] = React.useState<string | null>(null)
  const [poolOpen, setPoolOpen] = React.useState(false)
  const [kitSel, setKitSel] = React.useState<string>(parent?.kitId ?? "auto")
  const [refsText, setRefsText] = React.useState((parent?.refs ?? []).join("\n"))
  const [polish, setPolish] = React.useState(parent?.polish ?? true)
  const [turbo, setTurbo] = React.useState(parent?.turbo ?? false)
  const [mechanical, setMechanical] = React.useState(parent?.mechanical ?? false)
  const detectedKit = React.useMemo(() => (kitSel === "auto" ? detectKit(prompt) : kitById(kitSel)), [kitSel, prompt])
  const refs = React.useMemo(() => refsText.split(/\s+/).map((x) => x.trim()).filter((x) => /^(https:\/\/|git@)/.test(x)), [refsText])
  const agent = agents.find((a) => a.id === agentId)
  const repoPath = agent && !agent.template ? agent.repoPath : folder
  /** Expert-agent defaults become routing pins for every build kind. */
  const agentOverrides = React.useMemo(() => {
    const prefer = agent?.runDefaults?.prefer
    return prefer && pool.includes(prefer) ? Object.fromEntries((["architecture", "backend", "frontend", "algorithm", "integration"] as const).map((k) => [k, prefer])) : undefined
  }, [agent, pool])

  const run: SilentCodeRun | null = result ? (edit ? { ...result.run, plan: edit.plan, routing: edit.routing, manual } : result.run) : null
  const unrouted = run?.routing.filter((r) => !r.primaryModelId).length ?? 0
  const openQuestions = (result?.run.questions ?? []).filter((q) => !answers[q.id] && answers[q.id] !== "")

  const guard = async (label: string, fn: () => Promise<void>) => {
    setUiError(null)
    try {
      await fn()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[silent-code] ${label} failed:`, msg)
      setUiError(`${label}: ${msg}`)
    }
  }
  const pickFolder = () =>
    guard(t("common.browse"), async () => {
      const backend = await getBackend()
      const p = await backend.pickDirectory()
      if (p) {
        setFolder(p)
        setAgentId(undefined)
      }
    })
  const newFolder = () => setNewName((v) => (v === null ? "" : v))
  const createFolder = () =>
    guard(t("code.newFolder"), async () => {
      const name = (newName ?? "").trim()
      if (!name) return
      const backend = await getBackend()
      const p = await backend.createProjectDir(name, useSettingsStore.getState().settings.workspaceDir?.trim() || undefined)
      setFolder(p)
      setAgentId(undefined)
      setNewName(null)
    })
  const makePlan = (withAnswers = false) =>
    guard(t("code.makePlan"), async () => {
      setEdit(null)
      setApproved(false)
      const qa = withAnswers && result ? (result.run.questions ?? []).map((q) => ({ ...q, answer: answers[q.id] || undefined })) : undefined
      if (parent && !parent.repoPath && repoPath && !agentId) await useRunsStore.getState().attachRepo(parent.id, repoPath)
      const res = await planWithAi({ prompt, pool, executionMode: mode, costMode, repoAgentId: agentId, repoPath, parentRunId: parent?.id, answers: qa, kitId: detectedKit?.id ?? "", refs, polish, turbo, mechanical, overrides: agentOverrides })
      setResult(res)
      if (!withAnswers) setAnswers({})
      setStep("plan")
    })
  /** Terminal-triggered run: plan → approve → start, no clicks (questions from the planner stay unanswered). */
  const autoRun = (req0: NonNullable<typeof autostart>) =>
    guard("silent run", async () => {
      let req = { ...req0 }
      console.warn("[autostart] autoRun start", req.folder)
      setPrompt(req.prompt)
      setFolder(req.folder)
      const expert = req.agent ? agents.find((a) => a.name.toLowerCase() === req.agent!.toLowerCase() || a.id === req.agent) : undefined
      if (req.agent && !expert) console.warn("[autostart] --agent not found, ignored", req.agent)
      setAgentId(expert?.id)
      const d = expert?.runDefaults
      if (d?.kitId !== undefined && req.kit == null) req = { ...req, kit: d.kitId || "" }
      if (d?.pool?.length && !req.pool?.length) req = { ...req, pool: d.pool }
      if (d?.prefer && !req.prefer) req = { ...req, prefer: d.prefer }
      if (d?.costMode && !req.cost) req = { ...req, cost: d.costMode }
      if (d?.polish !== undefined && req.polish == null) req = { ...req, polish: d.polish }
      if (d?.turbo && !req.turbo) req = { ...req, turbo: true }
      if (d?.mechanical && !req.mechanical) req = { ...req, mechanical: true }
      if (req.turbo) setTurbo(true)
      if (req.mechanical) setMechanical(true)
      if (req.kit != null) setKitSel(req.kit === "auto" ? "auto" : req.kit)
      if (req.polish != null) setPolish(req.polish)
      const cost = (["economy", "balanced", "max-quality"] as CostMode[]).find((c) => c === req.cost) ?? costMode
      if (req.cost) setCostMode(cost)
      const kit = !req.kit || req.kit === "auto" ? detectKit(req.prompt) : kitById(req.kit)
      const runPool = req.pool?.length ? req.pool.filter((ref) => modelLabels[ref]) : pool
      if (req.pool?.length) setPool(runPool)
      if (req.pool?.length && runPool.length !== req.pool.length) console.warn("[autostart] unknown pool refs ignored", req.pool.filter((ref) => !modelLabels[ref]))
      const prefer = req.prefer && runPool.includes(req.prefer) ? req.prefer : undefined
      if (req.prefer && !prefer) console.warn("[autostart] --prefer not in pool, ignored", req.prefer)
      const overrides = prefer ? Object.fromEntries((["architecture", "backend", "frontend", "algorithm", "integration"] as const).map((k) => [k, prefer])) : undefined
      const res = await planWithAi({ prompt: req.prompt, pool: runPool, executionMode: mode, costMode: cost, repoAgentId: expert?.id, repoPath: req.folder, kitId: kit?.id ?? "", refs, polish: req.polish ?? true, turbo: req.turbo, mechanical: req.mechanical, overrides })
      console.warn("[autostart] planned", JSON.stringify({ source: res.source, error: res.error, subtasks: res.run.plan.length, questions: res.run.questions?.length ?? 0 }))
      setResult(res)
      setAnswers({})
      setStep("plan")
      const planned = res.run
      if (res.source !== "ai") {
        setUiError(`${t("code.planFallback", { error: res.error ?? "" })} — silent run: not starting a heuristic plan; fix the planner or start from the UI.`)
        return
      }
      if (planned.routing.some((r) => !r.primaryModelId)) {
        setUiError(t("code.unroutedHint", { n: planned.routing.filter((r) => !r.primaryModelId).length }))
        return
      }
      // Nobody is at the keyboard: planner questions get a standing answer so workers do not stall or guess silently.
      const autoAnswer = "Nobody is available to answer; decide yourself using best judgment and industry defaults, and document the decision in README.md."
      const questions = (planned.questions ?? []).map((q) => ({ ...q, answer: q.answer || autoAnswer }))
      const promptWithAnswers = questions.length ? `${planned.prompt}\n\nClarifications:\n${questions.map((q) => `- ${q.question} → ${q.answer}`).join("\n")}` : planned.prompt
      setApproved(true)
      setStep("start")
      setStarting(true)
      try {
        await start({ ...planned, prompt: promptWithAnswers, questions, manual: false })
        navigate(`/code/${planned.id}`)
      } finally {
        setStarting(false)
      }
    })
  // The shell sets the store first and navigates second: the store update re-renders before the URL
  // carries `auto`, so the URL param must be a dependency too (2026-09-25: a queued run was lost this way).
  const autoParam = params.get("auto")
  React.useEffect(() => {
    if (autostart) console.warn("[autostart] composer effect", JSON.stringify({ autoParam, hasParent: Boolean(parent) }))
    if (!autostart || !autoParam) return
    const req = autostart
    // Consuming the slot re-renders and re-runs this effect, so nothing here may be cancelled by cleanup.
    useRunsStore.setState({ autostart: undefined })
    queueMicrotask(() => void autoRun(req))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, autoParam])

  const launch = () =>
    guard(t("code.startRun"), async () => {
      if (!run || unrouted || !approved) return
      setStarting(true)
      try {
        const answered = (run.questions ?? []).map((q) => ({ ...q, answer: answers[q.id] || q.answer }))
        const promptWithAnswers = answered.some((q) => q.answer) ? `${run.prompt}\n\nClarifications:\n${answered.filter((q) => q.answer).map((q) => `- ${q.question} → ${q.answer}`).join("\n")}` : run.prompt
        await start({ ...run, prompt: promptWithAnswers, questions: answered, manual })
        navigate(`/code/${run.id}`)
      } finally {
        setStarting(false)
      }
    })

  const stepChip = (s: Step, i: number) => <span key={s} className={cn("mono flex h-6 items-center gap-1 rounded-sm border px-2 text-[10px] uppercase", step === s ? "border-text-1 text-text-1" : "border-line text-text-3")}>{i + 1} {t(`code.steps.${s}` as const)}</span>

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 p-6">
      <PageHeader eyebrow={t("code.title")} title={t("code.subtitle")} description={parent ? `${t("code.continuesRun", { title: parent.title })} · ${t("code.developHint")}` : t("code.description")} actions={<div className="flex gap-1">{(["task", "plan", "start"] as Step[]).map(stepChip)}</div>} />

      <div className={cn("grid gap-5", step === "task" ? "2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" : "grid-cols-1")}>
        <div className={cn("flex flex-col gap-4", step !== "task" && "hidden")}>
          {uiError && (
            <div className="flex items-start gap-3 rounded-sm border border-danger/50 bg-danger/5 px-4 py-3 text-xs text-danger">
              <AlertTriangle className="size-4 shrink-0" />
              <span className="mono flex-1 break-all">{uiError}</span>
              <button type="button" onClick={() => setUiError(null)} className="text-text-3 hover:text-text-1">×</button>
            </div>
          )}
          {newName !== null && (
            <div className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-ink-2 px-4 py-3 text-xs">
              <span className="text-text-2">{t("code.newFolderPrompt")}</span>
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void createFolder(); if (e.key === "Escape") setNewName(null) }} placeholder="my-project" className="mono min-w-[200px] flex-1 rounded-sm border border-line bg-ink px-2 py-1 text-text-1 outline-none focus:border-text-2" />
              <NeonButton size="sm" disabled={!newName.trim()} onClick={() => void createFolder()}><FolderGit2 />{t("common.create")}</NeonButton>
              <button type="button" onClick={() => setNewName(null)} className="text-text-3 hover:text-text-1">{t("common.cancel")}</button>
            </div>
          )}
          {parent && (
            <div className="flex flex-col gap-2 rounded-sm border border-line bg-ink-2 px-4 py-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <GitBranch className="size-3 text-text-3" />
                <span className="font-medium text-text-1">{t("code.continuesRun", { title: parent.title })}</span>
                <RunStatusBadge status={parent.status} label={labels.runStatus[parent.status]} />
                <button type="button" onClick={() => navigate(`/code/${parent.id}`)} className="ml-auto text-text-2 underline-offset-2 hover:text-text-1 hover:underline">{t("code.openParent")}</button>
              </div>
              <ul className="flex flex-col gap-0.5 text-text-2">
                {parent.plan.map((s) => (
                  <li key={s.id} className="flex gap-2"><span className={cn("mono shrink-0", s.state === "completed" ? "text-text-3" : "text-warn")}>{s.state === "completed" ? "✓" : "•"}</span><span className="truncate">{s.title}{s.deviations.length ? ` · ${t("code.deviationsCount", { n: s.deviations.length })}` : ""}</span></li>
                ))}
              </ul>
              <div className="text-text-3">{t("code.developHint")}</div>
            </div>
          )}
          {parent && !repoPath && (
            <div className="flex flex-wrap items-center gap-3 rounded-sm border border-warn/50 bg-warn/5 px-4 py-3 text-xs text-warn">
              <AlertTriangle className="size-4 shrink-0" />
              <span className="flex-1">{t("code.parentNoFolder")}</span>
              <button type="button" onClick={pickFolder} className="flex items-center gap-1 rounded-sm border border-warn/50 px-2 py-1 text-[11px] hover:bg-warn/10"><FolderOpen className="size-3" />{t("common.browse")}</button>
            </div>
          )}
          <GlowCard tone="cyan" className="flex flex-col gap-0 p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-[10px] font-semibold tracking-[0.18em] text-text-2 uppercase">
              <Zap className="size-3" />{t("code.prompt")}
              <span className="ml-auto flex items-center gap-2 normal-case tracking-normal">
                <Bot className="size-3 text-text-3" />
                <select value={agentId ?? ""} onChange={(e) => {
                  const id = e.target.value || undefined
                  setAgentId(id)
                  const picked = agents.find((a) => a.id === id)
                  if (picked && !picked.template) setFolder(undefined)
                  const d = picked?.runDefaults
                  if (d) {
                    if (d.kitId !== undefined) setKitSel(d.kitId || "")
                    if (d.pool?.length) setPool(d.pool.filter((ref) => modelLabels[ref]))
                    if (d.costMode) setCostMode(d.costMode)
                    if (d.polish !== undefined) setPolish(d.polish)
                    setTurbo(Boolean(d.turbo))
                    setMechanical(Boolean(d.mechanical))
                    if (d.refs?.length) setRefsText(d.refs.join("\n"))
                  }
                }} className="rounded-sm border border-line bg-ink-2 px-1.5 py-0.5 text-[11px] text-text-1 outline-none focus:border-text-2">
                  <option value="">{t("code.noAgent")}</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.template ? `★ ${a.name}` : a.name}</option>)}
                </select>
                {(!agent || agent.template) && <button type="button" onClick={pickFolder} className="flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-2 hover:border-text-2 hover:text-text-1"><FolderOpen className="size-3" />{t("common.browse")}</button>}
                {(!agent || agent.template) && <button type="button" onClick={newFolder} className="flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-2 hover:border-text-2 hover:text-text-1"><FolderGit2 className="size-3" />{t("code.newFolder")}</button>}
              </span>
            </div>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} placeholder={t("code.promptPlaceholder")} className="mono min-h-[150px] resize-y border-0 bg-transparent px-4 text-[15px] leading-7 shadow-none focus-visible:ring-0" />
            <div className={cn("flex flex-wrap items-center gap-3 border-t border-line px-4 py-2 text-[11px]", repoPath ? "text-text-3" : "text-warn")}>
              {repoPath ? <span className="mono flex min-w-0 items-center gap-1 truncate text-text-2"><FolderGit2 className="size-3 shrink-0" />{repoPath}</span> : <span>{t("code.folderRequired")}</span>}
              <span className="ml-auto flex items-center gap-2">
                {prompt.trim().length < 8 && repoPath && <span className="text-text-3">{t("code.promptTooShort")}</span>}
                {!repoPath ? (
                  <NeonButton size="sm" variant="outline" onClick={pickFolder}><FolderOpen />{t("code.pickFolderFirst")}</NeonButton>
                ) : (
                  <NeonButton size="sm" disabled={prompt.trim().length < 8 || !pool.length || planning} onClick={() => void makePlan(false)}>{planning ? <Loader2 className="animate-spin" /> : <Sparkles />}{planning ? t("code.planning") : t("code.makePlan")}</NeonButton>
                )}
              </span>
            </div>
          </GlowCard>
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow={t("code.pool")} title={`${pool.length} / ${models.length}`} description={models.length ? t("code.poolHint") : t("code.poolEmpty")} actions={<div className="flex gap-1 text-xs"><button type="button" onClick={() => setPool(models.map((m) => modelRef(m.providerId, m.id)))} className="text-text-2 hover:text-text-1">{t("code.all")}</button><span className="text-text-3">·</span><button type="button" onClick={() => setPool([])} className="text-text-2 hover:text-text-1">{t("code.noneSel")}</button></div>} />
            {poolOpen ? (
              <ModelSelectorGrid compact models={models} selected={pool} onToggle={(ref) => setPool(pool.includes(ref) ? pool.filter((x) => x !== ref) : [...pool, ref])} />
            ) : (
              <button type="button" onClick={() => setPoolOpen(true)} className="flex flex-wrap items-center gap-1 text-left text-[11px] text-text-2 hover:text-text-1">
                {pool.slice(0, 8).map((ref) => <span key={ref} className="mono rounded-sm border border-line px-1.5 py-0.5">{modelLabels[ref] ?? ref}</span>)}
                {pool.length > 8 && <span className="mono px-1">+{pool.length - 8}</span>}
                <span className="ml-1 underline-offset-2 hover:underline">{t("code.editPool")}</span>
              </button>
            )}
            {poolOpen && <button type="button" onClick={() => setPoolOpen(false)} className="self-end text-[11px] text-text-2 hover:text-text-1">{t("code.collapsePool")}</button>}
          </GlowCard>
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow={t("code.kit")} title={detectedKit ? detectedKit.name[lang] : t("code.kitNone")} description={t("code.kitHint")} actions={
              <select value={kitSel} onChange={(e) => setKitSel(e.target.value)} className="rounded-sm border border-line bg-ink-2 px-1.5 py-0.5 text-[11px] text-text-1 outline-none focus:border-text-2">
                <option value="auto">{t("code.kitAuto")}{kitSel === "auto" && detectedKit ? ` · ${detectedKit.name[lang]}` : ""}</option>
                <option value="">{t("code.kitNone")}</option>
                {BUILTIN_KITS.map((k) => <option key={k.id} value={k.id}>{k.name[lang]}</option>)}
              </select>
            } />
            {detectedKit && (
              <div className="flex flex-wrap gap-1 text-[11px] text-text-2">
                {detectedKit.references.map((r) => <span key={r.name} title={r.hint} className="mono rounded-sm border border-line px-1.5 py-0.5">{r.url.replace("https://github.com/", "")}</span>)}
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <label className="flex flex-col gap-1 text-[11px] text-text-2">
                <span>{t("code.refs")}</span>
                <textarea value={refsText} onChange={(e) => setRefsText(e.target.value)} rows={2} placeholder="https://github.com/org/repo" className="mono resize-y rounded-sm border border-line bg-ink px-2 py-1 text-[11px] text-text-1 outline-none focus:border-text-2" />
                <span className="text-text-3">{t("code.refsHint")}</span>
              </label>
              <label className="flex items-start gap-2 text-xs text-text-1">
                <input type="checkbox" checked={polish && !turbo} disabled={turbo} onChange={(e) => setPolish(e.target.checked)} className="mt-0.5" />
                <span><span className="block font-medium">{t("code.polish")}</span><span className="block text-[11px] text-text-3">{t("code.polishHint")}</span></span>
              </label>
              <label className="flex items-start gap-2 text-xs text-text-1">
                <input type="checkbox" checked={turbo} onChange={(e) => setTurbo(e.target.checked)} className="mt-0.5" />
                <span><span className="block font-medium">{t("code.turbo")}</span><span className="block text-[11px] text-text-3">{t("code.turboHint")}</span></span>
              </label>
              <label className="flex items-start gap-2 text-xs text-text-1">
                <input type="checkbox" checked={mechanical} onChange={(e) => setMechanical(e.target.checked)} className="mt-0.5" />
                <span><span className="block font-medium">{t("code.mechanical")}</span><span className="block text-[11px] text-text-3">{t("code.mechanicalHint")}</span></span>
              </label>
            </div>
          </GlowCard>
          <div className="grid gap-4 md:grid-cols-2">
            <GlowCard className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase"><Workflow className="size-3" />{t("code.mode")}</div>
              {(["staged", "parallel", "sequential"] as ExecutionMode[]).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={cn("flex items-center justify-between rounded-md border px-3 py-2 text-left", mode === m ? "border-text-2 bg-ink-3" : "border-line hover:border-line-strong")}>
                  <span><span className="block text-sm font-medium">{t(`code.modes.${m}` as const)}</span><span className="block text-[11px] text-text-3">{t(`code.modeHints.${m}` as const)}</span></span>
                  <span className={cn("size-2 rounded-full", mode === m ? "bg-text-1" : "bg-line-strong")} />
                </button>
              ))}
            </GlowCard>
            <GlowCard className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase"><Wallet className="size-3" />{t("code.cost")}</div>
              {COST_MODES.map((c) => (
                <button key={c} type="button" onClick={() => setCostMode(c)} className={cn("flex items-center justify-between rounded-md border px-3 py-2 text-sm", costMode === c ? "border-text-2 bg-ink-3" : "border-line hover:border-line-strong")}>
                  {t(`code.costModes.${c}` as const)}
                  <span className={cn("size-2 rounded-full", costMode === c ? "bg-text-1" : "bg-line-strong")} />
                </button>
              ))}
            </GlowCard>
          </div>
        </div>

        {step === "task" && (
          <GlowCard className="flex h-fit flex-col gap-3">
            <SectionHeader eyebrow={t("code.steps.plan")} title={t("code.makePlan")} description={t("code.autoHint")} />
            {!repoPath ? (
              <NeonButton size="lg" variant="outline" onClick={pickFolder} className="h-11 w-full text-base"><FolderOpen />{t("code.pickFolderFirst")}</NeonButton>
            ) : (
              <NeonButton size="lg" disabled={prompt.trim().length < 8 || !pool.length || planning} onClick={() => void makePlan(false)} className="h-11 w-full text-base">{planning ? <Loader2 className="animate-spin" /> : <Sparkles />}{planning ? t("code.planning") : t("code.makePlan")}</NeonButton>
            )}
          </GlowCard>
        )}

        {step !== "task" && run && result && (
          <div className="flex flex-col gap-4">
            {result.source !== "ai" && (
              <div className="flex items-start gap-3 rounded-sm border border-warn/50 bg-warn/5 px-4 py-3 text-xs text-warn">
                <AlertTriangle className="size-4 shrink-0" />
                <span className="flex-1">{t("code.planFallback", { error: result.error ?? "" })}</span>
              </div>
            )}
            <GlowCard className="flex flex-col gap-3">
              <SectionHeader
                eyebrow={t("code.preview")}
                title={result.plan?.summary || run.title}
                description={`${t("code.subtasks", { n: run.plan.length })} · ${t("code.modelsCount", { n: new Set(run.routing.map((r) => r.primaryModelId).filter(Boolean)).size })} · ${t(`code.modes.${mode}` as const)} · ${result.source === "ai" ? t("code.plannedBy", { model: modelLabels[result.plannerModel ?? ""] ?? result.plannerModel ?? "AI" }) : t("code.planFallback", { error: result.error ?? "" })}`}
                actions={<NeonButton size="sm" variant="outline" onClick={() => { setStep("task"); setResult(null); setEdit(null); setApproved(false) }}><RotateCcw />{t("common.back")}</NeonButton>}
              />
              {result.plan && (result.plan.assumptions.length > 0 || result.plan.excluded.length > 0) && (
                <div className="grid gap-2 text-[11px] text-text-3 md:grid-cols-2">
                  {result.plan.assumptions.length > 0 && <div><span className="uppercase tracking-wider">{t("code.assumptions")}:</span> {result.plan.assumptions.join(" · ")}</div>}
                  {result.plan.excluded.length > 0 && <div><span className="uppercase tracking-wider">{t("code.excludedByAi")}:</span> {result.plan.excluded.join(" · ")}</div>}
                </div>
              )}
            </GlowCard>

            {(run.questions ?? []).length > 0 && (
              <div className="flex flex-col gap-3">
                <SectionHeader eyebrow={t("code.questionsTitle")} title={`${openQuestions.length} / ${(run.questions ?? []).length}`} description={t("code.questionsHint")} actions={<NeonButton size="sm" variant="outline" disabled={planning || !Object.values(answers).some(Boolean)} onClick={() => void makePlan(true)}>{planning ? <Loader2 className="animate-spin" /> : <Sparkles />}{t("code.replan")}</NeonButton>} />
                {(run.questions ?? []).map((q) =>
                  answers[q.id] !== undefined ? (
                    <div key={q.id} className="flex items-start gap-2 rounded-md border border-line px-3 py-2 text-xs"><Check className="mt-0.5 size-3.5 text-success" /><span className="min-w-0"><span className="text-text-2">{q.question}</span> <span className="text-text-1">→ {answers[q.id] || t("code.skip")}</span></span></div>
                  ) : (
                    <QuestionCard key={q.id} title={t("code.questionsTitle")} question={q.question} why={q.why} options={result.plan?.questions.find((x) => x.id === q.id)?.options} onAnswer={(a) => setAnswers((s) => ({ ...s, [q.id]: a }))} onSkip={() => setAnswers((s) => ({ ...s, [q.id]: "" }))} />
                  ),
                )}
              </div>
            )}

            <GlowCard className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">{t("code.planEditor")}</span>
                <div className="ml-auto flex rounded-sm border border-line text-[11px]">
                  <button type="button" onClick={() => { setManual(false); setEdit(null) }} className={cn("px-2 py-0.5", !manual ? "bg-text-1 text-black" : "text-text-2")}>{t("code.auto")}</button>
                  <button type="button" onClick={() => { setManual(true); if (!edit) setEdit({ plan: run.plan, routing: run.routing }) }} className={cn("px-2 py-0.5", manual ? "bg-text-1 text-black" : "text-text-2")}>{t("code.manual")}</button>
                </div>
              </div>
              <div className="text-[11px] text-text-3">{manual ? t("code.manualHint") : t("code.autoHint")}</div>
              <PlanEditor plan={run.plan} routing={run.routing} models={models} pool={pool} costMode={costMode} manual={manual} onChange={(e) => { setEdit(e); setManual(true); setApproved(false) }} kindLabels={labels.kinds} />
              {run.plan.some((s) => s.rationale) && (
                <ul className="flex flex-col gap-1 text-[11px] text-text-3">{run.plan.filter((s) => s.rationale).map((s) => <li key={s.id}><span className="text-text-2">{labels.kinds[s.kind]}:</span> {s.rationale}</li>)}</ul>
              )}
            </GlowCard>

            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
              <GlowCard><RouteGraph plan={run.plan} routing={run.routing} labels={modelLabels} kindLabels={labels.kinds} /></GlowCard>
              <GlowCard className="flex flex-col gap-3">
                <CostMeter tokens={run.estimate.tokens} seconds={run.estimate.seconds} labels={{ tokens: t("code.tokens"), time: t("code.time"), cost: t("code.costUsd"), estimate: t("code.estimate") }} />
                <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase"><Route className="size-3" />{t("code.routing")}</div>
                <ul className="flex flex-col gap-1 text-[11px]">
                  {run.plan.map((s) => {
                    const r = run.routing.find((x) => x.subtaskId === s.id)
                    return <li key={s.id} className="flex items-center gap-2"><span className="w-24 shrink-0 text-text-2">{labels.kinds[s.kind]}</span>{r?.primaryModelId ? <ModelTag modelRef={r.primaryModelId} label={modelLabels[r.primaryModelId]} size="xs" /> : <span className="text-danger">{t("code.unrouted")}</span>}</li>
                  })}
                </ul>
                {!approved ? (
                  <NeonButton size="lg" disabled={unrouted > 0 || openQuestions.length > 0 && false} onClick={() => { setApproved(true); setStep("start") }} className="h-11 w-full"><Check />{t("code.approve")}</NeonButton>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-xs text-success"><Check className="size-3.5" />{t("code.approved")}</div>
                    <NeonButton size="lg" disabled={!run || unrouted > 0 || starting} onClick={launch} className="h-11 w-full text-base"><Play />{starting ? t("code.starting") : unrouted ? t("code.unroutedHint", { n: unrouted }) : t("code.startRun")}</NeonButton>
                  </>
                )}
              </GlowCard>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Live view of one run: progress, worker questions, cards, graph, timeline, report, project chat, develop. */
function RunView({ runId }: { runId: string }) {
  const t = useT()
  const lang = useI18nStore((st) => st.language)
  const labels = useLabels()
  const navigate = useNavigate()
  const run = useRunsStore((s) => s.byId(runId))
  const usage = useRunsStore((s) => s.usage[runId])
  const cancel = useRunsStore((s) => s.cancel)
  const split = useRunsStore((s) => s.split)
  const answer = useRunsStore((s) => s.answer)
  const openDrawer = useUiStore((s) => s.openDrawer)
  const drawer = useUiStore((s) => s.drawer)
  const providers = useProvidersStore((s) => s.providers)
  const agents = useAgentsStore((s) => s.agents)
  const createAgent = useAgentsStore((s) => s.create)
  const createChat = useChatsStore((s) => s.create)
  const chats = useChatsStore((s) => s.chats)
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
  const questions = run.plan.filter((s) => s.state === "blocked" && s.question)
  const existingChat = chats.find((c) => c.runId === run.id)

  const attachFolder = async () => {

    const backend = await getBackend()

    const p = await backend.pickDirectory()

    if (p) await useRunsStore.getState().attachRepo(run.id, p)

  }

  const askProject = async () => {
    if (existingChat) return navigate(`/chat/${existingChat.id}`)
    const usedRefs = run.plan.map((s) => s.assignedModelId).filter((x): x is string => Boolean(x))
    const strongest = usedRefs.sort((a, b) => usedRefs.filter((x) => x === b).length - usedRefs.filter((x) => x === a).length)[0] ?? run.routing[0]?.primaryModelId ?? ""
    const [providerId, ...rest] = strongest.split(":")
    let agent = agents.find((a) => a.sourceRunId === run.id) ?? agents.find((a) => a.id === run.repoAgentId)
    if (!agent) {
      const brief = [t("settings.projectAgentGateway"), `Run: ${run.title}. Request: ${run.prompt}`, ...run.plan.filter((s) => s.summary).map((s) => `- ${labels.kinds[s.kind]}: ${s.summary}`)].join("\n")
      agent = await createAgent({ name: run.title.slice(0, 40), repoPath: run.repoPath ?? "", providerId: (providerId || "codex") as never, modelId: rest.join(":"), gatewayPrompt: brief, sourceRunId: run.id, permissions: { write: false, fileCreateDelete: false, gitCommit: false } })
    }
    const chat = await createChat({ kind: "repo-agent", providerId: agent.providerId, modelId: agent.modelId, repoAgentId: agent.id, repoPath: agent.repoPath, gatewayPrompt: agent.gatewayPrompt, title: `${run.title} · ${t("code.askProject")}`, runId: run.id })
    navigate(`/chat/${chat.id}`)
  }

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 p-6">
      <PageHeader
        eyebrow={t("code.title")}
        title={<span className="flex items-center gap-3">{run.title}<RunStatusBadge status={run.status} label={labels.runStatus[run.status]} />{run.planSource && <TacticalChip size="xs">{run.planSource === "ai" ? "AI plan" : t("code.planFallback", { error: "" }).replace(/\(.*\)/, "").trim()}</TacticalChip>}</span>}
        description={<span className="flex flex-wrap items-center gap-3 text-xs"><span className="mono text-text-2">“{run.prompt.length > 160 ? run.prompt.slice(0, 157) + "…" : run.prompt}”</span>{run.repoPath && <span className="mono flex items-center gap-1"><FolderGit2 className="size-3" />{run.repoPath}</span>}{run.parentRunId && <button type="button" onClick={() => navigate(`/code/${run.parentRunId}`)} className="flex items-center gap-1 text-text-2 hover:text-text-1"><GitBranch className="size-3" />{t("code.continuesRun", { title: useRunsStore.getState().byId(run.parentRunId)?.title ?? "…" })}</button>}</span>}
        actions={
          run.status === "running" ? (
            <>
              <NeonButton variant="outline" onClick={() => cancel(run.id)} className="border-danger/40 text-danger hover:border-danger hover:text-danger"><Square />{t("code.cancelRun")}</NeonButton>
              <DeleteRunButton runId={run.id} />
            </>
          ) : (
            <>
              <DeleteRunButton runId={run.id} />
              {!run.repoPath && <NeonButton variant="outline" onClick={attachFolder} className="border-warn/50 text-warn hover:border-warn"><FolderOpen />{t("code.attachFolder")}</NeonButton>}
              <NeonButton variant="outline" onClick={askProject}><MessageSquare />{t("code.askProject")}</NeonButton>
              <NeonButton onClick={() => navigate(`/code?continue=${run.id}`)}><Zap />{t("code.develop")}</NeonButton>
            </>
          )
        }
      />
      {questions.map((s) => (
        <QuestionCard key={s.id} title={`${t("code.workerQuestion")} · ${labels.kinds[s.kind]}`} question={s.question!} hint={t("code.workerQuestionHint")} onAnswer={(text) => answer(run.id, s.id, text)} />
      ))}
      <GlowCard tone={run.status === "running" ? "cyan" : run.status === "failed" ? "danger" : run.status === "completed" ? "success" : "default"} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="font-heading text-3xl font-semibold tabular-nums">{pct}%</div>
          <div className="text-xs text-text-2">
            <div>{t("code.complete", { done, total: run.plan.length })}{failed ? <span className="text-danger"> · {t("code.failedN", { n: failed })}</span> : null}{questions.length ? <span className="text-warn"> · {t("code.pendingQuestions", { n: questions.length })}</span> : null}</div>
            <div className="text-text-3">{t(`code.modes.${run.executionMode}` as const)} · {t(`code.costModes.${run.costMode}` as const)}{elapsed ? ` · ${formatDuration(elapsed)} ${t("code.elapsed")}` : ""}</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-[10px] tracking-[0.16em] text-text-3 uppercase">{t("code.activeModels")}</span>
            {active.length ? active.map((m) => <TacticalChip key={m} tone="cyan" dot pulse><ModelTag modelRef={m} label={modelLabels[m]} size="xs" /></TacticalChip>) : <TacticalChip>{t("common.none")}</TacticalChip>}
          </div>
        </div>
        <ProgressBar value={pct} active={run.status === "running"} size="lg" tone={run.status === "failed" ? "danger" : run.status === "completed" ? "success" : "cyan"} />
      </GlowCard>
      {run.spec && (
        <details className="rounded-sm border border-line bg-ink-2 px-4 py-2 text-xs">
          <summary className="cursor-pointer text-[10px] font-semibold tracking-[0.18em] text-text-2 uppercase">{t("code.spec")}{run.kitId ? ` · ${kitById(run.kitId)?.name[lang] ?? run.kitId}` : ""}</summary>
          <pre className="mono mt-2 max-h-[320px] overflow-auto whitespace-pre-wrap text-text-2">{run.spec}</pre>
        </details>
      )}
      {run.report && <RunReport report={run.report} />}
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <section>
            <SectionHeader eyebrow={t("code.workers")} title={t("code.workersHint")} className="mb-3" />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{run.plan.map((s) => <AgentWorkerCard key={s.id} subtask={s} now={now} selected={drawer?.subtaskId === s.id} kindLabel={labels.kinds[s.kind]} stateLabel={labels.states[s.state]} onOpen={() => openDrawer(run.id, s.id)} onSplit={run.status === "running" ? () => split(run.id, s.id) : undefined} splitLabel={t("code.split")} />)}</div>
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

/** Two-click delete (the webview has no confirm()): first click arms for 4 s, second click cancels + deletes the run. */
function DeleteRunButton({ runId }: { runId: string }) {
  const t = useT()
  const navigate = useNavigate()
  const remove = useRunsStore((s) => s.remove)
  const [armed, setArmed] = React.useState(false)
  React.useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <NeonButton
      variant="outline"
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }
        void remove(runId).then(() => navigate("/code"))
      }}
      className={armed ? "border-danger bg-danger/15 text-danger" : "border-line text-text-3 hover:border-danger/60 hover:text-danger"}
    >
      <Trash2 />
      {armed ? t("code.confirmDelete") : t("code.deleteRun")}
    </NeonButton>
  )
}

export function SilentCodeScreen() {
  const { runId } = useParams()
  const [params] = useSearchParams()
  return runId ? <RunView runId={runId} /> : <Composer key={params.get("continue") ?? params.get("agent") ?? "new"} />
}
