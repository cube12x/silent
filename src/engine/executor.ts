import type { Attempt, ProviderModel, RoutingDecision, RunReport, SilentCodeRun, Subtask, WorkerState } from "@/domain"
import { isTerminalState } from "@/domain"
import { EventBus } from "./events"
import { nextModel } from "./router"
import { ModelIndex } from "./capabilities"
import { effortFor, timeoutFor } from "./effort"
import type { Worker, WorkerHandle, WorkerJob, WorkerResult, WorkerSink } from "./workers/Worker"

export interface ExecutorOptions {
  /** Retries of the same model before falling back. Default 1. */
  maxRetriesPerModel?: number
  /** Cap on concurrent workers for `parallel`/`staged`. */
  maxConcurrency?: number
  /** Gateway brief prepended to every job. */
  gatewayBrief?: string
  sandbox?: "read-only" | "workspace-write"
  /** Outbound network for worker shells (package installs). Default: on when the sandbox is workspace-write. */
  network?: boolean
  now?: () => number
  /** Models the pool refs resolve to (for fallback/escalation and display). */
  models?: ProviderModel[]
  /** Continuations of a timed-out session before falling back. Default 2. */
  maxContinuations?: number
  /** Questions a single subtask may ask before it is failed. Default 5. */
  maxQuestions?: number
  /** Shared project context (e.g. docs/ARCHITECTURE-BRIEF.md) prepended to every brief; updatable while running. */
  context?: string
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
  private waiters = new Map<string, (answer: string | null) => void>()
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
    for (const w of this.waiters.values()) w(null)
    this.waiters.clear()
    for (const s of this.subtasks.values()) {
      if (!isTerminalState(s.state)) this.setState(s, "failed", s.progress, "cancelled")
    }
    this.bus.emit({ type: "run.cancelled", runId: this.run.id, at: this.now() })
  }

  /** Replace the shared project context for subsequent attempts (e.g. after the architecture task wrote the brief). */
  setContext(text: string | undefined): void {
    this.opts.context = text
  }

  /** Deliver the user's answer to a blocked subtask; its session resumes with the answer. */
  answer(subtaskId: string, text: string): boolean {
    const w = this.waiters.get(subtaskId)
    if (!w) return false
    this.waiters.delete(subtaskId)
    w(text)
    return true
  }

  /** Subtasks currently waiting for an answer. */
  pendingQuestions(): Array<{ subtaskId: string; question: string }> {
    return Array.from(this.waiters.keys()).map((id) => ({ subtaskId: id, question: this.subtasks.get(id)?.question ?? "" }))
  }

  private report(): RunReport {
    const all = this.snapshot
    return {
      done: all.filter((s) => s.state === "completed" && s.summary).map((s) => `${s.title}: ${s.summary}`),
      deviations: all.flatMap((s) => s.deviations.map((d) => `${s.title}: ${d}`)),
      openQuestions: all.filter((s) => s.state === "blocked" && s.question).map((s) => `${s.title}: ${s.question}`),
      finishedAt: this.now(),
    }
  }

  async start(): Promise<"completed" | "failed" | "cancelled"> {
    this.bus.emit({ type: "run.started", runId: this.run.id, at: this.now() })
    this.bus.emit({ type: "run.status", runId: this.run.id, status: "running", at: this.now() })

    const limit = this.run.executionMode === "sequential" ? 1 : (this.opts.maxConcurrency ?? (this.run.executionMode === "staged" ? 4 : 8))
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
    this.bus.emit({ type: "run.report", runId: this.run.id, report: this.report(), at: this.now() })
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
    const maxContinuations = this.opts.maxContinuations ?? 2
    let modelId = decision.primaryModelId
    let cause: Attempt["cause"] = "initial"
    const tried: string[] = []
    let attemptNo = 0

    while (!this.cancelled) {
      attemptNo += 1
      let retriesOnModel = 0
      let continuations = 0
      let result = await this.attempt(subtask, modelId, attemptNo, cause)
      // The worker asked the user something: block, wait for the answer, resume the same session.
      let questions = 0
      while (!result.ok && result.blocked && !this.cancelled) {
        const sessionId = subtask.attempts.at(-1)?.sessionId
        questions += 1
        if (!sessionId || questions > (this.opts.maxQuestions ?? 5)) break
        subtask.question = result.question
        this.setState(subtask, "blocked", subtask.progress)
        this.bus.emit({ type: "subtask.question", runId: this.run.id, subtaskId, question: result.question ?? "", at: this.now() })
        const answer = await new Promise<string | null>((resolve) => this.waiters.set(subtaskId, resolve))
        if (answer === null) return
        subtask.answers.push(answer)
        subtask.question = undefined
        this.bus.emit({ type: "subtask.answered", runId: this.run.id, subtaskId, answer, at: this.now() })
        attemptNo += 1
        result = await this.attempt(subtask, modelId, attemptNo, "answer", sessionId, answer)
      }
      // A timeout is not a failure of the model: resume the same session and let it finish.
      while (!result.ok && result.timedOut && continuations < maxContinuations && !this.cancelled) {
        const sessionId = subtask.attempts.at(-1)?.sessionId
        if (!sessionId) break
        continuations += 1
        attemptNo += 1
        this.bus.emit({ type: "subtask.retry", runId: this.run.id, subtaskId, modelId, attempt: attemptNo, reason: "timeout → continue session", at: this.now() })
        result = await this.attempt(subtask, modelId, attemptNo, "continue", sessionId)
      }
      while (!result.ok && result.retryable && !result.timedOut && retriesOnModel < maxRetries && !this.cancelled) {
        retriesOnModel += 1
        attemptNo += 1
        this.bus.emit({ type: "subtask.retry", runId: this.run.id, subtaskId, modelId, attempt: attemptNo, reason: result.error ?? "failed", at: this.now() })
        result = await this.attempt(subtask, modelId, attemptNo, "retry")
      }
      if (result.deviations?.length) {
        subtask.deviations.push(...result.deviations)
        this.bus.emit({ type: "subtask.deviations", runId: this.run.id, subtaskId, deviations: [...subtask.deviations], at: this.now() })
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
      if (result.blocked) {
        // Unanswered after the question budget: leave it blocked so the user can still answer later.
        this.setState(subtask, "failed", subtask.progress, result.question)
        return
      }
      if (!next || (!result.retryable && !result.timedOut)) {
        this.setState(subtask, "failed", subtask.progress, result.error)
        return
      }
      this.bus.emit({ type: "subtask.fallback", runId: this.run.id, subtaskId, fromModelId: modelId, toModelId: next.modelId, cause: next.cause, reason: result.error ?? "failed", at: this.now() })
      modelId = next.modelId
      cause = next.cause
    }
  }

  private attempt(subtask: Subtask, modelId: string, n: number, cause: Attempt["cause"], resumeSessionId?: string, answer?: string) {
    const attempt: Attempt = { n, modelId, startedAt: this.now(), outcome: "running", cause, sessionId: resumeSessionId }
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
      session: (sessionId) => {
        attempt.sessionId = sessionId
        this.bus.emit({ type: "subtask.session", runId: this.run.id, subtaskId: subtask.id, sessionId, at: this.now() })
      },
    }
    const model = this.models.get(modelId)
    const job: WorkerJob = {
      runId: this.run.id,
      subtask: structuredClone(subtask),
      modelId,
      attempt: n,
      brief: answer !== undefined
        ? `The user answered your question: ${answer}\n\nContinue the task with this answer. When done, reply with a concise summary, then a "SILENT_DEVIATIONS:" list (or "SILENT_DEVIATIONS: none").`
        : resumeSessionId
          ? "You were interrupted by a time limit. Continue exactly where you left off, finish the remaining work, then reply with a concise summary of what you changed and how you verified it, followed by a \"SILENT_DEVIATIONS:\" list (or \"SILENT_DEVIATIONS: none\")."
          : this.brief(subtask, modelId),
      repoPath: this.run.repoPath,
      sandbox: this.opts.sandbox ?? "workspace-write",
      network: this.opts.network ?? (this.opts.sandbox ?? "workspace-write") === "workspace-write",
      effort: subtask.effort ?? effortFor(subtask.kind, this.run.costMode, model?.tier),
      timeoutSecs: subtask.timeoutSecs ?? timeoutFor(subtask.kind, subtask.weight),
      resumeSessionId,
    }
    const worker = this.resolve(modelId, subtask.kind)
    const handle = worker.start(job, sink)
    this.handles.set(subtask.id, handle)
    return handle.done
      .catch((e: unknown): WorkerResult => ({ ok: false, summary: "worker crashed", error: e instanceof Error ? e.message : String(e), retryable: true }))
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
      this.opts.context ? `PROJECT CONTEXT (already discovered — do not re-scan the repository for this):\n${this.opts.context.slice(0, 8000)}` : "",
      `Task: ${subtask.title}`,
      subtask.description,
      upstream.length ? `Upstream results:\n${upstream.map((u) => `- ${u}`).join("\n")}` : "",
      (this.opts.network ?? (this.opts.sandbox ?? "workspace-write") === "workspace-write") ? "Environment: the shell has outbound network access (package installs, git fetch and HTTP work)." : "Environment: the shell has NO network access. Do not attempt installs or downloads; if the task needs them, ask with SILENT_QUESTION.",
      "Rules: (1) Do exactly what the request says. If you cannot or should not do something the user asked for (policy, legal, access, missing information, ambiguity), DO NOT silently do something else: stop and write one line `SILENT_QUESTION: <your question to the user>` and end your reply; the user will answer and you will continue. (2) When you finish, reply with a concise summary of what you changed and how you verified it, then a section `SILENT_DEVIATIONS:` listing every point where you deviated from the request (or `SILENT_DEVIATIONS: none`).",
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
