import { create } from "zustand"
import { recordCommand } from "@/engine/retention"
import type { SubtaskKind, CostMode, ExecutionMode, RepoAgent, RunStatus, SilentCodeRun, Subtask, TerminalLine, Effort } from "@/domain"
import { modelRef } from "@/domain"
import { EventBus, type RunEvent } from "@/engine/events"
import { Executor } from "@/engine/executor"
import { planSubtasks } from "@/engine/planner"
import { routeSubtasks } from "@/engine/router"
import { estimateRun } from "@/engine/estimate"
import { renderGatewayBrief } from "@/engine/gateway"
import { effectivePolicy } from "@/engine/policy"
import { effortFor } from "@/engine/effort"
import { useHostStore } from "@/stores/host"
import { dosageLine, dosageWeights, orderByDosage } from "@/engine/dosage"
import { pickPlannerModel, requestAiPlan, subtasksFromAiPlan } from "@/engine/aiPlanner"
import type { AiPlan } from "@/engine/planSchema"
import { CliWorker, isModelRejected } from "@/engine/workers/CliWorker"
import { getBackend } from "@/services"
import { DONUSTURUCU_TOOL_NAME, DONUSTURUCU_TOOL_SOURCE } from "@/engine/blueprint/donusturucu"
import { reportError } from "./notify"
import { newId } from "@/lib/ids"
import { TIER_RANK } from "@/engine/capabilities"
import { kitById, renderKitBrief } from "@/domain/kits"
import type { AutostartRequest } from "@/services/backend"
import { providerInfo } from "@/providers/registry"
import { useI18nStore } from "@/i18n"
import { useAgentsStore } from "./agents"
import { useProvidersStore } from "./providers"
import { useSettingsStore } from "./settings"
import { useTerminalStore } from "./terminal"

export interface DraftInput {
  prompt: string
  pool: string[]
  executionMode: ExecutionMode
  costMode: CostMode
  repoAgentId?: string
  repoPath?: string
  /** Develop mode: the run being continued. */
  parentRunId?: string
  /** Planner questions with the user's answers (used on re-plan / start). */
  answers?: Array<{ id: string; question: string; why?: string; answer?: string }>
  /** Expert kit id ("" = none). */
  kitId?: string
  /** Effort every task starts with (overrides the per-kind policy; clamped per CLI at spawn time). */
  effort?: Effort
  /** Extra reference repository URLs. */
  refs?: string[]
  /** Polish review + fix round at the end (default true). */
  polish?: boolean
  /** Turbo preset: polish off, effort ≤ medium, lean plan (see SilentCodeRun.turbo). */
  turbo?: boolean
  /** Mechanical preset: cheapest pool model for mechanical kinds (see SilentCodeRun.mechanical). */
  mechanical?: boolean
  /** Lite / Bölücü preset (Faz 4): only disjoint build tasks, implies Turbo. */
  lite?: boolean
  /** Pin these kinds to a model ref (e.g. `silent run --prefer codex:gpt-6-astra` pins every build kind). */
  overrides?: Partial<Record<SubtaskKind, string>>
}

export interface PlanResult {
  run: SilentCodeRun
  source: "ai" | "heuristic"
  plan?: AiPlan
  plannerModel?: string
  error?: string
}

interface RunsState {
  runs: SilentCodeRun[]
  usage: Record<string, { tokens: number; costUsd: number }>
  /** Last non-system terminal line per subtask (ms): `silent status` flags a running task that has printed nothing for 10 min. */
  lastOutputAt: Record<string, number>
  executors: Record<string, Executor>
  planning: boolean
  /** `silent run …` request waiting for the composer to pick it up. */
  autostart?: AutostartRequest
  load(): Promise<void>
  /** Heuristic plan (instant, used as fallback and for tests). */
  draft(input: DraftInput): SilentCodeRun
  /** AI plan through a real CLI (read-only); falls back to the heuristic plan. */
  plan(input: DraftInput): Promise<PlanResult>
  start(run: SilentCodeRun): Promise<void>
  /** Answer a blocked subtask's question; its CLI session resumes. */
  answer(runId: string, subtaskId: string, text: string): boolean
  /** Görevi böl: stop the running attempt and let the worker hand the rest back as parallel sub-tasks. */
  split(runId: string, subtaskId: string): boolean
  /** Görev aktarımı: continue the subtask on another model (undefined = next by dosage order). */
  handover(runId: string, subtaskId: string, toRef?: string): boolean
  /** Models this run will not start on any more (quota/limit). */
  deadModels(runId: string): string[]
  cancel(runId: string): void
  /** `silent cancel`: cancel every run still planning or running; returns how many. */
  cancelAll(): number
  /** Bind a working folder to an existing run (older runs may have none); persisted. */
  attachRepo(runId: string, repoPath: string): Promise<void>
  remove(runId: string): Promise<void>
  /** Cancel everything that runs and delete every run record (terminal lines included). */
  removeAll(): Promise<void>
  loadTerminal(runId: string, subtaskId: string): Promise<void>
  byId(id: string | undefined): SilentCodeRun | undefined
  activeCount(): number
  pendingQuestions(): Array<{ runId: string; subtaskId: string; question: string }>
}

/** Per-run serialised DB writes (the report upsert and the final status upsert used to race); `remove` waits on it. */
const persistChains = new Map<string, Promise<void>>()
/** Runs the user deleted: a persist queued afterwards is dropped so the row never comes back. */
const removedRuns = new Set<string>()
export function _persistChain(runId: string, fn: () => Promise<void>): Promise<void> {
  if (removedRuns.has(runId)) return Promise.resolve()
  const prev = persistChains.get(runId) ?? Promise.resolve()
  const next = prev.then(fn).catch((err: unknown) => console.error("run upsert failed", err))
  persistChains.set(runId, next)
  return next
}

export function applyEvent(run: SilentCodeRun, e: RunEvent): SilentCodeRun {
  const patch = (id: string, fn: (s: Subtask) => Subtask) => ({ ...run, plan: run.plan.map((s) => (s.id === id ? fn(s) : s)) })
  switch (e.type) {
    case "run.started":
      return { ...run, status: "running", startedAt: e.at }
    case "run.status":
      return { ...run, status: e.status as RunStatus, finishedAt: e.status === "completed" || e.status === "failed" ? e.at : run.finishedAt }
    case "run.cancelled":
      return { ...run, status: "cancelled", finishedAt: e.at }
    case "run.failed": {
      // The reason lands in the report's notes (the only persisted free-text slot on a run).
      const report = run.report ?? { done: [], deviations: [], openQuestions: [], finishedAt: e.at }
      return { ...run, status: "failed", finishedAt: e.at, report: { ...report, notes: [...(report.notes ?? []), e.reason] } }
    }
    case "run.capped":
      return { ...run, waitingSlots: e.ready > 0 ? { ready: e.ready, cap: e.cap } : undefined }
    case "run.report":
      return { ...run, report: e.report }
    case "subtask.added":
      return { ...run, plan: [...run.plan, e.subtask] }
    case "subtask.state":
      return patch(e.subtaskId, (s) =>
        e.state === "failed"
          ? { ...s, state: e.state, progress: e.progress ?? s.progress, lastUpdate: e.at, summary: s.summary ?? e.error, attempts: s.attempts.map((a) => (a.outcome === "running" ? { ...a, outcome: "failure", finishedAt: e.at, error: e.error ?? "failed" } : a)) }
          : { ...s, state: e.state, progress: e.progress ?? s.progress, lastUpdate: e.at },
      )
    case "subtask.assigned":
      return patch(e.subtaskId, (s) => ({ ...s, assignedModelId: e.modelId, attempts: [...s.attempts.filter((a) => a.n !== e.attempt.n), e.attempt], lastUpdate: e.at }))
    case "subtask.retry":
    case "subtask.fallback":
      return patch(e.subtaskId, (s) => ({ ...s, attempts: s.attempts.map((a) => (a.outcome === "running" ? { ...a, outcome: "failure", finishedAt: e.at, error: e.reason } : a)) }))
    case "subtask.summary":
      return patch(e.subtaskId, (s) => ({ ...s, summary: e.summary, attempts: s.attempts.map((a) => (a.outcome === "running" ? { ...a, outcome: "success", finishedAt: e.at } : a)) }))
    case "subtask.question":
      return patch(e.subtaskId, (s) => ({ ...s, question: e.question, state: "blocked", attempts: s.attempts.map((a) => (a.outcome === "running" ? { ...a, outcome: "failure", finishedAt: e.at, error: `question: ${e.question}` } : a)) }))
    case "subtask.answered":
      return patch(e.subtaskId, (s) => ({ ...s, question: undefined, answers: [...s.answers, e.answer] }))
    case "subtask.deviations":
      return patch(e.subtaskId, (s) => ({ ...s, deviations: e.deviations, notes: e.notes ?? s.notes }))
    case "subtask.session":
      return patch(e.subtaskId, (s) => ({ ...s, attempts: s.attempts.map((a, i) => (i === s.attempts.length - 1 ? { ...a, sessionId: e.sessionId } : a)) }))
    case "worker.command":
      return patch(e.subtaskId, (s) => ({ ...s, commands: recordCommand(s.commands, e.command) }))
    case "worker.file":
      return patch(e.subtaskId, (s) => (s.files.includes(e.path) ? s : { ...s, files: [...s.files, e.path] }))
    default:
      return run
  }
}

/** Route a plan and wrap it into a run; applies manual policy pins (model/effort/timeout per kind). */
function finishDraft(id: string, plan: Subtask[], input: DraftInput, agent: RepoAgent | undefined): SilentCodeRun {
  const settings = useSettingsStore.getState().settings
  const models = useProvidersStore.getState().availableModels()
  const policy = effectivePolicy(settings, input.costMode)
  const table = settings.routingPolicy.mode === "manual" ? settings.routingPolicy.table : {}
  const overrides = { ...settings.routingOverrides, ...(input.overrides ?? {}) }
  const EFFORT_RANK = { low: 0, medium: 1, high: 2, xhigh: 3 } as const
  for (const s of plan) {
    // The AI planner may suggest a tier/effort, but never above the cost policy (max-quality lifts the ceiling).
    if (s.tierHint && TIER_RANK[s.tierHint] > TIER_RANK[policy[s.kind]] && input.costMode !== "max-quality") s.tierHint = policy[s.kind]
    const ceiling = effortFor(s.kind, input.costMode, s.tierHint)
    if (s.effort && EFFORT_RANK[s.effort] > EFFORT_RANK[ceiling]) s.effort = ceiling
    const row = table[s.kind]
    if (row?.modelRef && input.pool.includes(row.modelRef)) overrides[s.kind] = row.modelRef
    if (row?.effort && !s.effort) s.effort = row.effort
    if (row?.timeoutMin && !s.timeoutSecs) s.timeoutSecs = row.timeoutMin * 60
    // The Blueprint box's explicit effort wins over the policy ceiling (the user asked for it).
    if (input.effort) s.effort = input.effort
    // Turbo never thinks above medium: deep reasoning is where the minutes go (2026-09-30 measurement).
    if ((input.turbo || input.lite) && s.effort && EFFORT_RANK[s.effort] > EFFORT_RANK.medium) s.effort = "medium"
  }
  const weights = dosageWeights(settings)
  const pool = orderByDosage(input.pool, weights)
  const routing = routeSubtasks({ subtasks: plan, pool, models, costMode: input.costMode, overrides, policy, preferredModelRef: agent ? modelRef(agent.providerId, agent.modelId) : undefined, weights })
  const title = plan[0]?.title.replace(/^Architecture & task decomposition for /, "") ?? input.prompt
  return {
    id,
    title: title.charAt(0).toUpperCase() + title.slice(1),
    prompt: input.prompt,
    repoAgentId: agent?.id,
    repoPath: input.repoPath ?? agent?.repoPath,
    modelPool: pool,
    executionMode: input.executionMode,
    costMode: input.costMode,
    effort: input.effort,
    plan,
    routing,
    status: "planned",
    estimate: estimateRun(plan, routing, input.executionMode),
    createdAt: Date.now(),
    parentRunId: input.parentRunId,
    questions: input.answers,
    kitId: input.kitId || undefined,
    refs: input.refs?.filter(Boolean),
    polish: input.turbo || input.lite ? false : (input.polish ?? true),
    turbo: input.turbo || input.lite || undefined,
    lite: input.lite || undefined,
    mechanical: input.mechanical || undefined,
  }
}

export const useRunsStore = create<RunsState>((set, get) => ({
  runs: [],
  usage: {},
  executors: {},
  lastOutputAt: {},
  planning: false,

  async load() {
    const backend = await getBackend()
    const runs = (await backend.db.runs.list()).map((r) => {
      if (r.status !== "running") return r
      // A run left "running" in the DB has no executor after a restart: either it finished and only the
      // final status write was lost, or the app was closed mid-run.
      const done = r.plan.length > 0 && r.plan.every((s) => s.state === "completed")
      const last = Math.max(0, ...r.plan.map((s) => s.lastUpdate ?? 0))
      if (done) return { ...r, status: "completed" as const, finishedAt: r.finishedAt ?? (last || Date.now()) }
      return {
        ...r,
        status: "cancelled" as const,
        finishedAt: r.finishedAt ?? Date.now(),
        plan: r.plan.map((s) => (s.state === "completed" || s.state === "failed" ? s : { ...s, state: "failed" as const, attempts: s.attempts.map((a) => (a.outcome === "running" ? { ...a, outcome: "cancelled" as const, error: "app closed" } : a)) })),
      }
    })
    set({ runs: runs.map((r) => ({ ...r, plan: r.plan.map((s) => ({ ...s, answers: s.answers ?? [], deviations: s.deviations ?? [] })) })).sort((a, b) => b.createdAt - a.createdAt) })
    // Persist the remap, or the DB keeps the run "running" forever and every launch repeats it (2026-09-30: four stale runs).
    const raw = await backend.db.runs.list()
    for (const r of runs) {
      const before = raw.find((x) => x.id === r.id)
      if (before && before.status === "running" && r.status !== "running") await backend.db.runs.upsert(r).catch(() => undefined)
    }
  },

  async attachRepo(runId, repoPath) {
    const run = get().byId(runId)
    if (!run || !repoPath) return
    const updated = { ...run, repoPath }
    set({ runs: get().runs.map((r) => (r.id === runId ? updated : r)) })
    const backend = await getBackend()
    await backend.db.runs.upsert(updated)
  },
  draft(input) {
    const agent = useAgentsStore.getState().byId(input.repoAgentId)
    const id = newId("run")
    const plan = planSubtasks({ prompt: input.prompt, repoPath: input.repoPath ?? agent?.repoPath, focusKinds: agent?.gatewayProfile.focusKinds }, id)
    return { ...finishDraft(id, plan, input, agent), planSource: "heuristic" }
  },

  async plan(input) {
    set({ planning: true })
    try {
      const backend = await getBackend()
      const agent = useAgentsStore.getState().byId(input.repoAgentId)
      const settings = useSettingsStore.getState().settings
      const all = useProvidersStore.getState().availableModels()
      const models = all.filter((m) => input.pool.includes(modelRef(m.providerId, m.id)))
      // Workers stay inside the pool; the planner may come from the whole catalog when the pool has no planner-capable CLI.
      const weights = dosageWeights(settings)
      const plannerModel = pickPlannerModel(models.length ? models : all, weights) ?? pickPlannerModel(all, weights) ?? pickPlannerModel(all)
      const heuristic = get().draft(input)
      if (!plannerModel) return { run: heuristic, source: "heuristic", error: "no model" }
      const repoPath = input.repoPath ?? agent?.repoPath
      let repoSummary: string | undefined
      if (repoPath) {
        try {
          const info = await backend.repoInspect(repoPath)
          repoSummary = `${info.name} at ${info.path}${info.isGitRepo ? ` (git, branch ${info.branch ?? "?"})` : " (not a git repo)"}, ${info.fileCount ?? "?"} files, languages: ${info.languages.join(", ") || "unknown"}. You may read files there.`
        } catch {
          repoSummary = `${repoPath} (could not inspect)`
        }
      }
      const parent = get().byId(input.parentRunId)
      const kit = kitById(input.kitId)
      try {
        const res = await requestAiPlan(
          backend,
          {
            prompt: input.prompt,
            repoPath,
            repoSummary,
            gatewayBrief: agent ? renderGatewayBrief(agent.gatewayProfile) : undefined,
            models,
            policy: effectivePolicy(settings, input.costMode),
            previous: parent ? { title: parent.title, summaries: parent.plan.map((s) => s.summary).filter((x): x is string => Boolean(x)), deviations: parent.plan.flatMap((s) => s.deviations) } : undefined,
            answers: input.answers?.filter((a) => a.answer).map((a) => ({ question: a.question, answer: a.answer! })),
            language: useI18nStore.getState().language,
            kitBrief: kit ? renderKitBrief(kit) : undefined,
            turbo: input.turbo || input.lite,
            mechanical: input.mechanical,
            lite: input.lite,
            dosage: dosageLine(settings, models.length ? models : all),
          },
          plannerModel,
        )
        const id = newId("run")
        const run = finishDraft(id, subtasksFromAiPlan(res.plan, id), input, agent)
        const questions = res.plan.questions.map((q) => ({ id: q.id, question: q.question, why: q.why, answer: input.answers?.find((a) => a.question === q.question)?.answer }))
        return { run: { ...run, planSource: "ai", spec: res.plan.spec || undefined, questions: questions.length ? questions : input.answers }, source: "ai", plan: res.plan, plannerModel: modelRef(plannerModel.providerId, plannerModel.id) }
      } catch (err) {
        console.warn("AI planner failed, using heuristic plan", err)
        return { run: heuristic, source: "heuristic", error: err instanceof Error ? err.message : String(err), plannerModel: modelRef(plannerModel.providerId, plannerModel.id) }
      }
    } finally {
      set({ planning: false })
    }
  },

  async start(run) {
    const backend = await getBackend()
    const agent = useAgentsStore.getState().byId(run.repoAgentId)
    const bus = new EventBus()
    const worker = new CliWorker(backend)
    const sandbox = agent && !agent.permissions.write ? "read-only" : "workspace-write"
    const network = sandbox === "workspace-write" && (agent ? agent.permissions.network : true)
    const t0 = Date.now()
    const mark = (label: string) => console.warn(`[start] ${label} +${((Date.now() - t0) / 1000).toFixed(1)}s`)
    // Dönüştürücü: every run gets the converter tool, so workers convert assets on demand (the brief points at it).
    if (run.repoPath) {
      try {
        await backend.blueprintWriteTool(run.repoPath, DONUSTURUCU_TOOL_NAME, DONUSTURUCU_TOOL_SOURCE)
      } catch (e) {
        console.warn("converter tool not written", e)
      }
    }
    // Expert kit: clone the reference repositories (host side, outside any CLI sandbox) and tell workers where they are.
    const kit = kitById(run.kitId)
    const refSpecs = [
      ...(kit?.references.map((r) => ({ name: r.name, url: r.url, hint: r.hint })) ?? []),
      ...(run.refs ?? []).map((url) => ({ name: url.replace(/\.git$/, "").split("/").filter(Boolean).slice(-1)[0] ?? "ref", url, hint: "user-provided reference" })),
    ]
    let kitBrief: string | undefined
    if (run.repoPath && refSpecs.length) {
      try {
        const synced = await backend.syncReferences(run.repoPath, refSpecs.map(({ name, url }) => ({ name, url })))
        mark(`references synced (${synced.filter((r) => r.ok).length}/${synced.length})`)
        const paths = synced.filter((r) => r.ok).map((r) => ({ name: r.name, path: r.path, hint: refSpecs.find((s) => s.name === r.name)?.hint ?? "" }))
        const failed = synced.filter((r) => !r.ok)
        if (failed.length) console.warn("reference clone failed", failed)
        kitBrief = kit ? renderKitBrief(kit, paths) : paths.length ? `Reference implementations (read-only, study before designing):\n${paths.map((p) => `- ${p.path} — ${p.hint}`).join("\n")}` : undefined
      } catch (err) {
        console.warn("reference sync failed", err)
        kitBrief = kit ? renderKitBrief(kit) : undefined
      }
    } else if (kit) {
      kitBrief = renderKitBrief(kit)
    }
    const poolModels = useProvidersStore.getState().availableModels().filter((m) => run.modelPool.includes(modelRef(m.providerId, m.id)))
    // The polish reviewer must be able to launch a browser (it play-tests); only then the strongest tier.
    const pw = dosageWeights(useSettingsStore.getState().settings)
    const polishModel = [...poolModels].filter((m) => pw[m.providerId] > 0).sort((a, b) => Number(providerInfo(b.providerId).capabilities.browser) - Number(providerInfo(a.providerId).capabilities.browser) || TIER_RANK[b.tier] - TIER_RANK[a.tier] || pw[b.providerId] - pw[a.providerId])[0]
    const executor = new Executor(run, () => worker, bus, { gatewayBrief: agent ? renderGatewayBrief(agent.gatewayProfile) : undefined, sandbox, network, spec: run.spec, kitBrief, polish: run.polish !== false, polishModelId: polishModel ? modelRef(polishModel.providerId, polishModel.id) : undefined, maxRetriesPerModel: 1, maxContinuations: 2, models: useProvidersStore.getState().availableModels(), concurrency: () => useHostStore.getState().cap(), warmSessions: useSettingsStore.getState().settings.warmSessions !== false, autoAnswerMs: Math.max(0, useSettingsStore.getState().settings.autoAnswerAfterMin ?? 10) * 60_000 })

    // Workers get the architecture brief (if the repo has one) instead of rediscovering the codebase.
    const loadContext = async () => {
      if (!run.repoPath) return
      try {
        // Kaşe: the repo digest (tree, exports, brief head) plus the architecture brief; workers read files only to edit them.
        const [digest, brief] = await Promise.all([backend.repoDigest(run.repoPath, 10 * 1024).catch(() => ""), backend.readProjectFile(run.repoPath, "docs/ARCHITECTURE-BRIEF.md", 32768)])
        const parts = [digest?.trim() ? digest.trim() : "", brief ? `docs/ARCHITECTURE-BRIEF.md:\n${brief}` : ""].filter(Boolean)
        executor.setContext(parts.length ? parts.join("\n\n") : undefined)
      } catch {
        /* optional */
      }
    }
    await loadContext()
    mark("context loaded")
    const started = { ...run, status: "running" as const, startedAt: Date.now() }
    set({ runs: [started, ...get().runs.filter((r) => r.id !== run.id)], executors: { ...get().executors, [run.id]: executor }, usage: { ...get().usage, [run.id]: { tokens: 0, costUsd: 0 } } })
    await backend.db.runs.upsert(started)
    mark("run persisted")
    // DB writes for one run are serialized: the report upsert (large JSON) and the final status upsert used to
    // race on the connection pool and could leave the run "running" forever (seen 2026-09-24).
    removedRuns.delete(run.id)
    const persist = (r: SilentCodeRun) => {
      void _persistChain(run.id, () => backend.db.runs.upsert(r))
    }
    if (agent) void useAgentsStore.getState().recordAction(agent.id, { kind: "run", title: run.title, detail: `${run.plan.length} subtasks`, ok: true }).catch(() => undefined)

    const pending: Record<string, TerminalLine[]> = {}
    const keep = useSettingsStore.getState().settings.logs.keepTerminalLines || 2000
    const flush = () => {
      for (const [subtaskId, lines] of Object.entries(pending)) {
        if (!lines.length) continue
        pending[subtaskId] = []
        void backend.db.terminal.append(run.id, subtaskId, lines, keep).catch(() => undefined)
      }
    }
    const flushTimer = setInterval(flush, 3000)

    bus.subscribe((e) => {
      if (e.type === "worker.log") {
        useTerminalStore.getState().append(e.subtaskId, e.line)
        ;(pending[e.subtaskId] ??= []).push(e.line)
        // Progress clock for the stall detector: heartbeats and Silent's own notes are "system", real CLI output is not.
        if (e.line.stream !== "system") set({ lastOutputAt: { ...get().lastOutputAt, [e.subtaskId]: e.line.ts } })
        return
      }
      if (e.type === "worker.usage") {
        const u = get().usage[run.id] ?? { tokens: 0, costUsd: 0 }
        set({
          usage: { ...get().usage, [run.id]: { tokens: u.tokens + e.tokens, costUsd: u.costUsd + e.costUsd } },
          runs: get().runs.map((r) => (r.id === run.id ? { ...r, plan: r.plan.map((s) => (s.id === e.subtaskId ? { ...s, tokens: (s.tokens ?? 0) + e.tokens, costUsd: Number(((s.costUsd ?? 0) + e.costUsd).toFixed(4)) } : s)) } : r)),
        })
        return
      }
      if (e.type === "subtask.fallback" && isModelRejected(e.reason)) useProvidersStore.getState().markUnavailable(e.fromModelId, e.reason)
      const current = get().runs.find((r) => r.id === run.id)
      if (!current) return
      const updated = applyEvent(current, e)
      set({ runs: get().runs.map((r) => (r.id === run.id ? updated : r)) })
      if (e.type === "run.completed" || e.type === "run.failed" || e.type === "run.cancelled") {
        clearInterval(flushTimer)
        flush()
        const usage = get().usage[run.id]
        const final = { ...updated, actual: usage ? { tokens: usage.tokens, costUsd: Number(usage.costUsd.toFixed(2)) } : undefined }
        const executors = { ...get().executors }
        delete executors[run.id]
        set({ runs: get().runs.map((r) => (r.id === run.id ? final : r)), executors })
        persist(final)
        if (agent) void useAgentsStore.getState().recordAction(agent.id, { kind: "run", title: run.title, detail: e.type.replace("run.", ""), ok: e.type === "run.completed" }).catch(() => undefined)
      } else if ((e.type === "subtask.state" && (e.state === "completed" || e.state === "failed" || e.state === "blocked")) || e.type === "subtask.assigned" || e.type === "subtask.question" || e.type === "subtask.deviations" || e.type === "run.report" || e.type === "subtask.added") {
        persist(updated)
        if (e.type === "subtask.state" && e.state === "completed") {
          void loadContext().catch((e) => reportError(e, "context"))
          // Diff polish: the reviewer reads the diff of what the run touched instead of replaying the product.
          executor.setChangedFiles(updated.plan.flatMap((s) => s.files))
          const done = updated.plan.find((s) => s.id === e.subtaskId)
          const since = done?.attempts[0]?.startedAt
          if (done && !done.files.length && run.repoPath && since) {
            void backend.changedFiles(run.repoPath, since).then((files) => {
              if (!files.length) return
              const cur = get().runs.find((r) => r.id === run.id)
              if (!cur) return
              const next = { ...cur, plan: cur.plan.map((s) => (s.id === done.id ? { ...s, files: files.slice(0, 200) } : s)) }
              set({ runs: get().runs.map((r) => (r.id === run.id ? next : r)) })
              executor.setChangedFiles(next.plan.flatMap((s) => s.files))
              persist(next)
            }).catch(() => {})
          }
        }
      }
    })
    void executor.start().catch((e) => reportError(e, "run"))
  },

  answer(runId, subtaskId, text) {
    return get().executors[runId]?.answer(subtaskId, text) ?? false
  },
  split(runId, subtaskId) {
    return get().executors[runId]?.requestSplit(subtaskId) ?? false
  },
  handover(runId, subtaskId, toRef) {
    return get().executors[runId]?.requestHandover(subtaskId, toRef) ?? false
  },
  deadModels(runId) {
    return get().executors[runId]?.deadModels ?? []
  },
  cancel(runId) {
    get().executors[runId]?.cancel()
  },
  cancelAll() {
    const live = get().runs.filter((r) => r.status === "running")
    for (const r of live) get().cancel(r.id)
    return live.length
  },
  async remove(runId) {
    removedRuns.add(runId)
    get().cancel(runId)
    set({ runs: get().runs.filter((r) => r.id !== runId) })
    // Let the queued upserts of this run land first, otherwise one of them would resurrect the deleted row.
    await (persistChains.get(runId) ?? Promise.resolve())
    persistChains.delete(runId)
    const backend = await getBackend()
    await backend.db.runs.delete(runId)
  },
  async removeAll() {
    const ids = get().runs.map((r) => r.id)
    for (const id of ids) {
      removedRuns.add(id)
      get().cancel(id)
    }
    set({ runs: [] })
    const backend = await getBackend()
    for (const id of ids) {
      await (persistChains.get(id) ?? Promise.resolve())
      persistChains.delete(id)
      await backend.db.runs.delete(id)
    }
  },
  async loadTerminal(runId, subtaskId) {
    if (useTerminalStore.getState().lines[subtaskId]?.length || get().executors[runId]) return
    const backend = await getBackend()
    const lines = await backend.db.terminal.listBySubtask(subtaskId)
    if (lines.length) useTerminalStore.getState().replace(subtaskId, lines)
  },
  byId(id) {
    return id ? get().runs.find((r) => r.id === id) : undefined
  },
  activeCount() {
    return get().runs.filter((r) => r.status === "running").reduce((n, r) => n + r.plan.filter((s) => !["waiting", "completed", "failed", "blocked"].includes(s.state)).length, 0)
  },
  pendingQuestions() {
    return Object.entries(get().executors).flatMap(([runId, ex]) => ex.pendingQuestions().map((q) => ({ runId, ...q })))
  },
}))
