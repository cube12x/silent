import { create } from "zustand"
import type { CostMode, ExecutionMode, RunStatus, SilentCodeRun, Subtask, TerminalLine } from "@/domain"
import { EventBus, type RunEvent } from "@/engine/events"
import { Executor } from "@/engine/executor"
import { planSubtasks } from "@/engine/planner"
import { routeSubtasks } from "@/engine/router"
import { estimateRun } from "@/engine/estimate"
import { renderGatewayBrief } from "@/engine/gateway"
import { CliWorker } from "@/engine/workers/CliWorker"
import { getBackend } from "@/services"
import { newId } from "@/lib/ids"
import { modelRef } from "@/domain"
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
}

interface RunsState {
  runs: SilentCodeRun[]
  usage: Record<string, { tokens: number; costUsd: number }>
  executors: Record<string, Executor>
  load(): Promise<void>
  draft(input: DraftInput): SilentCodeRun
  start(run: SilentCodeRun): Promise<void>
  cancel(runId: string): void
  remove(runId: string): Promise<void>
  loadTerminal(runId: string, subtaskId: string): Promise<void>
  byId(id: string | undefined): SilentCodeRun | undefined
  activeCount(): number
}

function applyEvent(run: SilentCodeRun, e: RunEvent): SilentCodeRun {
  const patch = (id: string, fn: (s: Subtask) => Subtask) => ({ ...run, plan: run.plan.map((s) => (s.id === id ? fn(s) : s)) })
  switch (e.type) {
    case "run.started":
      return { ...run, status: "running", startedAt: e.at }
    case "run.status":
      return { ...run, status: e.status as RunStatus, finishedAt: e.status === "completed" || e.status === "failed" ? e.at : run.finishedAt }
    case "run.cancelled":
      return { ...run, status: "cancelled", finishedAt: e.at }
    case "subtask.state":
      return patch(e.subtaskId, (s) => ({ ...s, state: e.state, progress: e.progress ?? s.progress, lastUpdate: e.at }))
    case "subtask.assigned":
      return patch(e.subtaskId, (s) => ({ ...s, assignedModelId: e.modelId, attempts: [...s.attempts.filter((a) => a.n !== e.attempt.n), e.attempt], lastUpdate: e.at }))
    case "subtask.retry":
    case "subtask.fallback":
      return patch(e.subtaskId, (s) => ({ ...s, attempts: s.attempts.map((a) => (a.outcome === "running" ? { ...a, outcome: "failure", finishedAt: e.at, error: e.reason } : a)) }))
    case "subtask.summary":
      return patch(e.subtaskId, (s) => ({ ...s, summary: e.summary, attempts: s.attempts.map((a) => (a.outcome === "running" ? { ...a, outcome: "success", finishedAt: e.at } : a)) }))
    case "worker.command":
      return patch(e.subtaskId, (s) => ({ ...s, commands: [...s.commands, e.command] }))
    case "worker.file":
      return patch(e.subtaskId, (s) => (s.files.includes(e.path) ? s : { ...s, files: [...s.files, e.path] }))
    default:
      return run
  }
}

export const useRunsStore = create<RunsState>((set, get) => ({
  runs: [],
  usage: {},
  executors: {},
  async load() {
    const backend = await getBackend()
    const runs = (await backend.db.runs.list()).map((r) =>
      r.status === "running" ? { ...r, status: "cancelled" as const, finishedAt: r.finishedAt ?? Date.now(), plan: r.plan.map((s) => (s.state === "completed" || s.state === "failed" ? s : { ...s, state: "failed" as const, summary: s.summary ?? "interrupted" })) } : r,
    )
    set({ runs: runs.sort((a, b) => b.createdAt - a.createdAt) })
  },
  draft(input) {
    const agent = useAgentsStore.getState().byId(input.repoAgentId)
    const id = newId("run")
    const plan = planSubtasks({ prompt: input.prompt, repoPath: input.repoPath ?? agent?.repoPath, focusKinds: agent?.gatewayProfile.focusKinds }, id)
    const settings = useSettingsStore.getState().settings
    const models = useProvidersStore.getState().availableModels()
    const routing = routeSubtasks({ subtasks: plan, pool: input.pool, models, costMode: input.costMode, overrides: settings.routingOverrides, preferredModelRef: agent ? modelRef(agent.providerId, agent.modelId) : undefined })
    const title = plan[0]?.title.replace(/^Architecture & task decomposition for /, "") ?? input.prompt
    return {
      id,
      title: title.charAt(0).toUpperCase() + title.slice(1),
      prompt: input.prompt,
      repoAgentId: agent?.id,
      repoPath: input.repoPath ?? agent?.repoPath,
      modelPool: input.pool,
      executionMode: input.executionMode,
      costMode: input.costMode,
      plan,
      routing,
      status: "planned",
      estimate: estimateRun(plan, routing, input.executionMode),
      createdAt: Date.now(),
    }
  },
  async start(run) {
    const backend = await getBackend()
    const agent = useAgentsStore.getState().byId(run.repoAgentId)
    const bus = new EventBus()
    const worker = new CliWorker(backend)
    const sandbox = agent && !agent.permissions.write ? "read-only" : "workspace-write"
    const executor = new Executor(run, () => worker, bus, { gatewayBrief: agent ? renderGatewayBrief(agent.gatewayProfile) : undefined, sandbox, maxRetriesPerModel: 1, maxContinuations: 2, models: useProvidersStore.getState().availableModels() })

    const started = { ...run, status: "running" as const, startedAt: Date.now() }
    set({ runs: [started, ...get().runs.filter((r) => r.id !== run.id)], executors: { ...get().executors, [run.id]: executor }, usage: { ...get().usage, [run.id]: { tokens: 0, costUsd: 0 } } })
    await backend.db.runs.upsert(started)
    if (agent) void useAgentsStore.getState().recordAction(agent.id, { kind: "run", title: run.title, detail: `${run.plan.length} subtasks`, ok: true })

    // Terminal lines: in-memory via the throttled terminal store; to SQLite in one batched insert every 3 s.
    const pending: Record<string, TerminalLine[]> = {}
    const keep = useSettingsStore.getState().settings.logs.keepTerminalLines || 2000
    const flush = () => {
      for (const [subtaskId, lines] of Object.entries(pending)) {
        if (!lines.length) continue
        pending[subtaskId] = []
        void backend.db.terminal.append(run.id, subtaskId, lines, keep)
      }
    }
    const flushTimer = setInterval(flush, 3000)

    bus.subscribe((e) => {
      if (e.type === "worker.log") {
        useTerminalStore.getState().append(e.subtaskId, e.line)
        ;(pending[e.subtaskId] ??= []).push(e.line)
        return
      }
      if (e.type === "worker.usage") {
        const u = get().usage[run.id] ?? { tokens: 0, costUsd: 0 }
        set({ usage: { ...get().usage, [run.id]: { tokens: u.tokens + e.tokens, costUsd: u.costUsd + e.costUsd } } })
        return
      }
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
        void backend.db.runs.upsert(final)
        if (agent) void useAgentsStore.getState().recordAction(agent.id, { kind: "run", title: run.title, detail: e.type.replace("run.", ""), ok: e.type === "run.completed" })
      } else if (e.type === "subtask.state" && (e.state === "completed" || e.state === "failed")) {
        void backend.db.runs.upsert(updated)
      }
    })
    void executor.start()
  },
  cancel(runId) {
    get().executors[runId]?.cancel()
  },
  async remove(runId) {
    get().cancel(runId)
    set({ runs: get().runs.filter((r) => r.id !== runId) })
    const backend = await getBackend()
    await backend.db.runs.delete(runId)
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
}))
