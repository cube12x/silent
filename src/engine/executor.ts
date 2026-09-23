import type { Attempt, ProviderModel, RoutingDecision, SilentCodeRun, Subtask, WorkerState } from "@/domain"
import { isTerminalState } from "@/domain"
import { EventBus } from "./events"
import { nextModel } from "./router"
import { ModelIndex } from "./capabilities"
import type { Worker, WorkerHandle, WorkerJob, WorkerSink } from "./workers/Worker"

export interface ExecutorOptions {
  /** Retries of the same model before falling back. Default 1. */
  maxRetriesPerModel?: number
  /** Cap on concurrent workers for `parallel`/`staged`. */
  maxConcurrency?: number
  /** Gateway brief prepended to every job. */
  gatewayBrief?: string
  sandbox?: "read-only" | "workspace-write"
  now?: () => number
  /** Models the pool refs resolve to (for fallback/escalation and display). */
  models?: ProviderModel[]
}

export type WorkerResolver = (modelId: string, kind: Subtask["kind"]) => Worker

/**
 * Runs a planned SilentCodeRun as a dependency DAG with retry → fallback → escalation.
 * Pure orchestration: knows nothing about React, Tauri or persistence. Emits RunEvents on the bus.
 */
export class Executor {
  private handles = new Map<string, WorkerHandle>()
  private cancelled = false
  private subtasks: Map<string, Subtask>
  private routing: Map<string, RoutingDecision>
  private summaries = new Map<string, string>()
  private readonly now: () => number
  private readonly run: SilentCodeRun
  private readonly resolve: WorkerResolver
  readonly bus: EventBus
  private readonly opts: ExecutorOptions
  private readonly models: ModelIndex

  constructor(run: SilentCodeRun, resolve: WorkerResolver, bus: EventBus, opts: ExecutorOptions = {}) {
    this.run = run
    this.resolve = resolve
    this.bus = bus
    this.opts = opts
    this.models = new ModelIndex(opts.models ?? [])
    this.subtasks = new Map(run.plan.map((s) => [s.id, structuredClone(s)]))
    this.routing = new Map(run.routing.map((r) => [r.subtaskId, r]))
    this.now = opts.now ?? Date.now
  }

  get snapshot(): Subtask[] {
    return this.run.plan.map((s) => this.subtasks.get(s.id)!)
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    for (const h of this.handles.values()) h.cancel()
    this.handles.clear()
    for (const s of this.subtasks.values()) {
      if (!isTerminalState(s.state)) this.setState(s, "failed", s.progress, "cancelled")
    }
    this.bus.emit({ type: "run.cancelled", runId: this.run.id, at: this.now() })
  }

  async start(): Promise<"completed" | "failed" | "cancelled"> {
    this.bus.emit({ type: "run.started", runId: this.run.id, at: this.now() })
    this.bus.emit({ type: "run.status", runId: this.run.id, status: "running", at: this.now() })

    const limit = this.run.executionMode === "sequential" ? 1 : (this.opts.maxConcurrency ?? (this.run.executionMode === "staged" ? 3 : 6))
    const running = new Map<string, Promise<void>>()

    while (!this.cancelled) {
      const all = this.snapshot
      if (all.every((s) => isTerminalState(s.state))) break
      const failed = all.filter((s) => s.state === "failed")
      if (failed.length) {
        // Dependents of a failed task can never run: mark blocked → failed and stop scheduling.
        for (const s of all) {
          if (!isTerminalState(s.state) && !running.has(s.id) && s.dependsOn.some((d) => this.subtasks.get(d)?.state === "failed")) {
            this.setState(s, "blocked", 0)
            this.setState(s, "failed", 0, "upstream failed")
          }
        }
        if (running.size === 0) break
      }
      const ready = all.filter(
        (s) => !isTerminalState(s.state) && !running.has(s.id) && s.state !== "blocked" && s.dependsOn.every((d) => this.subtasks.get(d)?.state === "completed"),
      )
      for (const s of ready) {
        if (running.size >= limit) break
        const p = this.execute(s.id).finally(() => running.delete(s.id))
        running.set(s.id, p)
      }
      if (running.size === 0) break
      await Promise.race(running.values())
    }

    if (this.cancelled) return "cancelled"
    const ok = this.snapshot.every((s) => s.state === "completed")
    if (ok) {
      this.bus.emit({ type: "run.status", runId: this.run.id, status: "completed", at: this.now() })
      this.bus.emit({ type: "run.completed", runId: this.run.id, at: this.now() })
      return "completed"
    }
    const reason = this.snapshot.filter((s) => s.state === "failed").map((s) => s.title).join(", ")
    this.bus.emit({ type: "run.status", runId: this.run.id, status: "failed", at: this.now() })
    this.bus.emit({ type: "run.failed", runId: this.run.id, reason: `Failed: ${reason}`, at: this.now() })
    return "failed"
  }

  private async execute(subtaskId: string): Promise<void> {
    const subtask = this.subtasks.get(subtaskId)!
    const decision = this.routing.get(subtaskId)
    if (!decision || !decision.primaryModelId) {
      this.setState(subtask, "failed", 0, "no model routed")
      return
    }
    const maxRetries = this.opts.maxRetriesPerModel ?? 1
    let modelId = decision.primaryModelId
    let cause: Attempt["cause"] = "initial"
    const tried: string[] = []
    let attemptNo = 0

    while (!this.cancelled) {
      attemptNo += 1
      let retriesOnModel = 0
      let result = await this.attempt(subtask, modelId, attemptNo, cause)
      while (!result.ok && result.retryable && retriesOnModel < maxRetries && !this.cancelled) {
        retriesOnModel += 1
        attemptNo += 1
        this.bus.emit({ type: "subtask.retry", runId: this.run.id, subtaskId, modelId, attempt: attemptNo, reason: result.error ?? "failed", at: this.now() })
        result = await this.attempt(subtask, modelId, attemptNo, "retry")
      }
      if (result.ok) {
        subtask.summary = result.summary
        this.summaries.set(subtaskId, result.summary)
        this.bus.emit({ type: "subtask.summary", runId: this.run.id, subtaskId, summary: result.summary, at: this.now() })
        this.setState(subtask, "completed", 100)
        return
      }
      if (this.cancelled) return
      tried.push(modelId)
      const next = nextModel(decision, tried, this.run.modelPool, this.models.all())
      if (!next || !result.retryable) {
        this.setState(subtask, "failed", subtask.progress, result.error)
        return
      }
      this.bus.emit({ type: "subtask.fallback", runId: this.run.id, subtaskId, fromModelId: modelId, toModelId: next.modelId, cause: next.cause, reason: result.error ?? "failed", at: this.now() })
      modelId = next.modelId
      cause = next.cause
    }
  }

  private attempt(subtask: Subtask, modelId: string, n: number, cause: Attempt["cause"]) {
    const attempt: Attempt = { n, modelId, startedAt: this.now(), outcome: "running", cause }
    subtask.attempts.push(attempt)
    subtask.assignedModelId = modelId
    subtask.lastUpdate = this.now()
    this.bus.emit({ type: "subtask.assigned", runId: this.run.id, subtaskId: subtask.id, modelId, attempt: { ...attempt }, at: this.now() })
    this.setState(subtask, "planning", 0)

    const sink: WorkerSink = {
      state: (state, progress) => this.setState(subtask, state, progress),
      log: (text, stream = "stdout") => this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId: subtask.id, line: { ts: this.now(), stream, text } }),
      command: (command) => {
        subtask.commands.push(command)
        this.bus.emit({ type: "worker.command", runId: this.run.id, subtaskId: subtask.id, command, at: this.now() })
      },
      file: (path) => {
        if (!subtask.files.includes(path)) subtask.files.push(path)
        this.bus.emit({ type: "worker.file", runId: this.run.id, subtaskId: subtask.id, path, at: this.now() })
      },
      usage: (tokens, costUsd) => this.bus.emit({ type: "worker.usage", runId: this.run.id, subtaskId: subtask.id, tokens, costUsd, at: this.now() }),
    }
    const job: WorkerJob = {
      runId: this.run.id,
      subtask: structuredClone(subtask),
      modelId,
      attempt: n,
      brief: this.brief(subtask, modelId),
      repoPath: this.run.repoPath,
      sandbox: this.opts.sandbox ?? "workspace-write",
    }
    const worker = this.resolve(modelId, subtask.kind)
    const handle = worker.start(job, sink)
    this.handles.set(subtask.id, handle)
    return handle.done
      .catch((e: unknown) => ({ ok: false, summary: "worker crashed", error: e instanceof Error ? e.message : String(e), retryable: true }))
      .then((r) => {
        this.handles.delete(subtask.id)
        attempt.finishedAt = this.now()
        attempt.outcome = this.cancelled ? "cancelled" : r.ok ? "success" : "failure"
        attempt.error = r.error
        return r
      })
  }

  private brief(subtask: Subtask, modelId: string): string {
    const model = this.models.get(modelId)
    const upstream = subtask.dependsOn.map((d) => this.summaries.get(d)).filter(Boolean)
    return [
      `You are ${model?.displayName ?? modelId}, working as the ${subtask.kind} worker in a Silent orchestration run.`,
      this.opts.gatewayBrief ?? "",
      `Task: ${subtask.title}`,
      subtask.description,
      upstream.length ? `Upstream results:\n${upstream.map((u) => `- ${u}`).join("\n")}` : "",
      "Report a concise summary of what you changed and how you verified it.",
    ]
      .filter(Boolean)
      .join("\n\n")
  }

  private setState(subtask: Subtask, state: WorkerState, progress?: number, error?: string): void {
    subtask.state = state
    if (progress !== undefined) subtask.progress = progress
    subtask.lastUpdate = this.now()
    if (error && state === "failed") subtask.summary = subtask.summary ?? error
    this.bus.emit({ type: "subtask.state", runId: this.run.id, subtaskId: subtask.id, state, progress: subtask.progress, at: this.now() })
  }
}
