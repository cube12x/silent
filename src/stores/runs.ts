import { create } from "zustand"
import type { CostMode, ExecutionMode, RunStatus, SilentCodeRun, Subtask, TerminalLine } from "@/domain"
import { EventBus, type RunEvent } from "@/engine/events"
import { Executor } from "@/engine/executor"
import { planSubtasks } from "@/engine/planner"
import { routeSubtasks } from "@/engine/router"
import { estimateRun } from "@/engine/estimate"
import { renderGatewayBrief } from "@/engine/gateway"
import { MODEL_BY_ID } from "@/engine/capabilities"
import { SimulatedWorker } from "@/engine/workers/SimulatedWorker"
import type { Worker } from "@/engine/workers/Worker"
import { CodexWorker } from "@/services/codexWorker"
import { getBackend } from "@/services"
import { newId } from "@/lib/ids"
import { useAgentsStore } from "./agents"
import { useActivityStore } from "./activity"
import { useSettingsStore } from "./settings"

const RING = 5000

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
  /** Live per-run terminal output, keyed by subtask id (ring buffer). */
  terminal: Record<string, TerminalLine[]>
  /** Per-run cumulative usage while running. */
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
  const patchSubtask = (id: string, fn: (s: Subtask) => Subtask) => ({ ...run, plan: run.plan.map((s) => (s.id === id ? fn(s) : s)) })
  switch (e.type) {
    case "run.started":
      return { ...run, status: "running", startedAt: e.at }
    case "run.status":
      return { ...run, status: e.status as RunStatus, finishedAt: e.status === "completed" || e.status === "failed" ? e.at : run.finishedAt }
    case "run.cancelled":
      return { ...run, status: "cancelled", finishedAt: e.at }
    case "subtask.state":
      return patchSubtask(e.subtaskId, (s) => ({ ...s, state: e.state, progress: e.progress ?? s.progress, lastUpdate: e.at }))
    case "subtask.assigned":
      return patchSubtask(e.subtaskId, (s) => ({ ...s, assignedModelId: e.modelId, attempts: [...s.attempts.filter((a) => a.n !== e.attempt.n), e.attempt], lastUpdate: e.at }))
    case "subtask.retry":
      return patchSubtask(e.subtaskId, (s) => ({ ...s, attempts: s.attempts.map((a) => (a.outcome === "running" ? { ...a, outcome: "failure", finishedAt: e.at, error: e.reason } : a)) }))
    case "subtask.fallback":
      return patchSubtask(e.subtaskId, (s) => ({ ...s, attempts: s.attempts.map((a) => (a.outcome === "running" ? { ...a, outcome: "failure", finishedAt: e.at, error: e.reason } : a)) }))
    case "subtask.summary":
      return patchSubtask(e.subtaskId, (s) => ({ ...s, summary: e.summary, attempts: s.attempts.map((a) => (a.outcome === "running" ? { ...a, outcome: "success", finishedAt: e.at } : a)) }))
    case "worker.command":
      return patchSubtask(e.subtaskId, (s) => ({ ...s, commands: [...s.commands, e.command] }))
    case "worker.file":
      return patchSubtask(e.subtaskId, (s) => (s.files.includes(e.path) ? s : { ...s, files: [...s.files, e.path] }))
    default:
      return run
  }
}

export const useRunsStore = create<RunsState>((set, get) => ({
  runs: [],
  terminal: {},
  usage: {},
  executors: {},
  async load() {
    const backend = await getBackend()
    const runs = (await backend.db.runs.list()).map((r) =>
      // Anything left "running" from a previous session was interrupted by an app restart.
      r.status === "running" ? { ...r, status: "cancelled" as const, finishedAt: r.finishedAt ?? Date.now(), plan: r.plan.map((s) => (s.state === "completed" || s.state === "failed" ? s : { ...s, state: "failed" as const, summary: s.summary ?? "Interrupted by app restart." })) } : r,
    )
    set({ runs })
  },
  draft(input) {
    const agent = useAgentsStore.getState().byId(input.repoAgentId)
    const id = newId("run")
    const plan = planSubtasks({ prompt: input.prompt, repoPath: input.repoPath ?? agent?.repoPath, focusKinds: agent?.gatewayProfile.focusKinds }, id)
    const settings = useSettingsStore.getState().settings
    const routing = routeSubtasks({ subtasks: plan, pool: input.pool, costMode: input.costMode, overrides: settings.routingOverrides, preferredModelId: agent?.primaryModelId })
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
    const simulated = new SimulatedWorker({ seed: run.id.length * 7919, failureRate: 0.15 })
    const codex = new CodexWorker(backend)
    const resolve = (modelId: string, kind: Subtask["kind"]): Worker => (MODEL_BY_ID[modelId]?.executable && codex.supports(kind, modelId) ? codex : simulated)
    const sandbox = agent && !agent.permissions.write ? "read-only" : "workspace-write"
    const executor = new Executor(run, resolve, bus, { gatewayBrief: agent ? renderGatewayBrief(agent.gatewayProfile) : undefined, sandbox, maxRetriesPerModel: 1 })

    set({ runs: [{ ...run, status: "running", startedAt: Date.now() }, ...get().runs.filter((r) => r.id !== run.id)], executors: { ...get().executors, [run.id]: executor }, usage: { ...get().usage, [run.id]: { tokens: 0, costUsd: 0 } } })
    await backend.db.runs.upsert({ ...run, status: "running", startedAt: Date.now() })
    void useActivityStore.getState().push({ kind: "run", title: `Silent Code · ${run.title}`, detail: `started · ${run.plan.length} subtasks · ${new Set(run.routing.map((r) => r.primaryModelId)).size} models`, refRoute: `/runs/${run.id}`, ok: true })
    if (agent) void useAgentsStore.getState().recordAction(agent.id, { kind: "run", title: `Silent Code: ${run.title}`, detail: `${run.plan.length} subtasks`, ok: true })

    const pendingLines: Record<string, TerminalLine[]> = {}
    const flushTimer = setInterval(() => {
      for (const [subtaskId, lines] of Object.entries(pendingLines)) {
        if (!lines.length) continue
        pendingLines[subtaskId] = []
        void backend.db.terminal.append(run.id, subtaskId, lines)
      }
    }, 1500)

    bus.subscribe((e) => {
      if (e.type === "worker.log") {
        const cur = get().terminal[e.subtaskId] ?? []
        const next = cur.length >= RING ? [...cur.slice(cur.length - RING + 1), e.line] : [...cur, e.line]
        set({ terminal: { ...get().terminal, [e.subtaskId]: next } })
        ;(pendingLines[e.subtaskId] ??= []).push(e.line)
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
        const usage = get().usage[run.id]
        const final = { ...updated, actual: usage ? { tokens: usage.tokens, costUsd: Number(usage.costUsd.toFixed(2)) } : undefined }
        set({ runs: get().runs.map((r) => (r.id === run.id ? final : r)) })
        const executors = { ...get().executors }
        delete executors[run.id]
        set({ executors })
        void backend.db.runs.upsert(final)
        void useActivityStore.getState().push({
          kind: "run",
          title: `Silent Code · ${run.title}`,
          detail: e.type === "run.completed" ? `completed · ${run.plan.length} subtasks${usage ? ` · $${usage.costUsd.toFixed(2)}` : ""}` : e.type === "run.cancelled" ? "cancelled" : e.reason,
          refRoute: `/runs/${run.id}`,
          ok: e.type === "run.completed",
        })
        if (agent) void useAgentsStore.getState().recordAction(agent.id, { kind: "run", title: `Silent Code: ${run.title}`, detail: e.type, ok: e.type === "run.completed" })
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
    if (get().terminal[subtaskId]?.length || get().executors[runId]) return
    const backend = await getBackend()
    const lines = await backend.db.terminal.listBySubtask(subtaskId)
    if (lines.length) set({ terminal: { ...get().terminal, [subtaskId]: lines } })
  },
  byId(id) {
    return id ? get().runs.find((r) => r.id === id) : undefined
  },
  activeCount() {
    return get().runs.filter((r) => r.status === "running").reduce((n, r) => n + r.plan.filter((s) => !["waiting", "completed", "failed", "blocked"].includes(s.state)).length, 0)
  },
}))
