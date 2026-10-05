import { CONVERTER_TOOLKIT, IMAGE_TOOL_HINT } from "./blueprint/prompt"
import { shellNotes } from "@/lib/platform"
import { isModelRejected, quotaResetAt } from "./modelErrors"
import { providerInfo } from "@/providers/registry"
import { parseModelRef, type ProviderId } from "@/domain"
import type { Attempt, ProviderModel, RoutingDecision, RunReport, SilentCodeRun, Subtask, WorkerState } from "@/domain"
import { isTerminalState } from "@/domain"
import { EventBus } from "./events"
import { nextModel } from "./router"
import { ModelIndex } from "./capabilities"
import { clampEffort, effortFor, timeoutFor } from "./effort"
import type { Worker, WorkerHandle, WorkerJob, WorkerResult, WorkerSink } from "./workers/Worker"

/** Continuation hint (Faz 3): a long task hands its remaining work back as parallel sub-briefs instead of running alone for another hour. */
/** The answer the executor sends when a worker's question stays unanswered past `autoAnswerMs` (2026-10-05: questions waited 37–44 min with nobody at the screen). */
export const AUTO_ANSWER = "Decide yourself using best judgment and continue; document the decision under SILENT_NOTES."

/** When an unanswered question will be auto-answered (ms epoch), or undefined when auto-answer is off. */
export function autoAnswerAtFor(blockedSince: number, autoAnswerMs: number | undefined): number | undefined {
  return autoAnswerMs && autoAnswerMs > 0 ? blockedSince + autoAnswerMs : undefined
}

/** Worker rule against the stalls seen in the terminals (2026-10-05): background jobs polled with sleep loops burned 10-minute tool calls 11 times. */
export const WORKER_FOREGROUND_RULE = "Run every command in the foreground and wait for it to finish; give long commands their own cap (e.g. `timeout 1200 npm run e2e`); never start a job in the background and poll it with `sleep`/`until` loops — one tool call per command. Never leave a server running when you finish, and never end your turn while something you started still runs."

export const SPLIT_HINT = "If more than ~20 min of work remain, do NOT continue alone: reply with `SILENT_SPLIT:` followed by 2–3 independent sub-briefs (one per line, each with its own `Owns:` paths, disjoint from each other), then stop; they will run in parallel as separate tasks."
/** `# HANDOVER` block shared by orchestration workers and Blueprint single sessions: what the previous model already did. */
export function handoverBlock(i: {
  fromModel: string
  reason: string
  files?: string[]
  commands?: string[]
  lastMessage?: string
  /** One line per earlier attempt (model · cause · outcome — error). */
  attempts?: string[]
  /** Questions the worker asked and the answers it got. */
  qa?: Array<{ question: string; answer?: string }>
  notes?: string[]
  deviations?: string[]
  /** `git status` / `git diff --stat` / diff of the task's files at handover time. */
  repoState?: string
  /** Git ref of the safety snapshot taken right before the handover. */
  snapshot?: string
}): string {
  const files = (i.files ?? []).slice(-40)
  return [
    "# HANDOVER",
    `A previous worker (${i.fromModel}) started this task and stopped: ${i.reason.slice(0, 300)}. The repository already contains its work — verify the current state first (git status/diff, run the checks), then continue from there; do not redo or revert what is already done, finish from where it stopped.`,
    i.attempts?.length ? `Earlier attempts:\n${i.attempts.join("\n")}` : "",
    i.qa?.length ? `Questions and answers so far:\n${i.qa.map((x) => `- Q: ${x.question}${x.answer ? `\n  A: ${x.answer}` : ""}`).join("\n")}` : "",
    i.notes?.length ? `Its notes:\n${i.notes.map((n) => `- ${n}`).join("\n")}` : "",
    i.deviations?.length ? `Its deviations from the request:\n${i.deviations.map((d) => `- ${d}`).join("\n")}` : "",
    files.length ? `Files it touched:\n${files.map((f) => `- ${f}`).join("\n")}` : "",
    i.commands?.length ? `Its last commands:\n${i.commands.map((c) => `- ${c}`).join("\n")}` : "",
    i.lastMessage?.trim() ? `Its last message:\n${i.lastMessage.trim().slice(-1500)}` : "",
    i.repoState?.trim() ? `## Repository state\n${i.repoState.trim().slice(0, 12000)}` : "",
    i.snapshot ? `Safety snapshot: ${i.snapshot} (the state before this handover; restorable)` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}

/** Brief for a user-requested split: stop now and hand the rest back. */
export const SPLIT_BRIEF = "STOP: the user wants the remaining work of this task split. Finish only the edit you are in the middle of (leave the checks green for your paths), then reply with a short summary of what is done so far, followed by `SILENT_SPLIT:` and 2–3 independent sub-briefs for the remaining work (one per line, each with its own `Owns:` paths, disjoint from each other), then `SILENT_DEVIATIONS: none`."

/** Where a handover comes from: the stopped model, why, its last words and where its commands start. */
type HandoverFrom = { modelId: string; reason: string; lastMessage?: string; commandsFrom: number }

export interface ExecutorOptions {
  /** Retries of the same model before falling back. Default 1. */
  maxRetriesPerModel?: number
  /** Cap on concurrent workers for `parallel`/`staged`. */
  maxConcurrency?: number
  /** Live host-load cap (Faz 3): read before every scheduling pass; Infinity = no extra cap. */
  concurrency?: () => number
  /** Warm sessions (Faz 3): a new task on the same model resumes the previous task's finished CLI session, so the files it already read stay in (cached) context. The runs store passes Settings.warmSessions. */
  warmSessions?: boolean
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
  /** Unattended runs: a SILENT_QUESTION nobody answers within this many ms gets `AUTO_ANSWER` (0/undefined = wait forever). */
  autoAnswerMs?: number
  /** Longest wait for a quota reset when no other model can take a task (default 6 h); longer resets fail the task. */
  maxQuotaWaitMs?: number
  /** Browser tasks may fall back to a browser-capable catalog model outside the pool when the pool has none left. */
  browserFallbackOutsidePool?: boolean
  /** Repo state for a handover brief (git status/stat/diff of the given files) and a safety snapshot ref; filled by the runs store. */
  repoState?: (files: string[]) => Promise<{ text: string; snapshot?: string }>
  /** Shared project context (e.g. docs/ARCHITECTURE-BRIEF.md) prepended to every brief; updatable while running. */
  context?: string
  /** English product spec from the planner; every worker builds against it. */
  spec?: string
  /** Expert kit brief (quality bar, checklist, reference paths). */
  kitBrief?: string
  /** After all subtasks complete: a review scores the result against spec + checklist and up to 3 fix tasks run. */
  polish?: boolean
  /** Model for the polish review and its fix tasks (strongest, browser-capable). */
  polishModelId?: string
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
  private order: string[] = []
  /** Polish review + fix subtasks: best-effort, never fail the run. */
  private polishIds = new Set<string>()
  private polishScore?: number
  private polishNotes?: string
  /** Warm sessions: model → finished session of its last task (with the tokens it has consumed so far). */
  private warm = new Map<string, { sessionId: string; tokens: number }>()
  /** Tokens consumed per session id (uncached input + output), for the warm-session ceiling. */
  private sessionTokens = new Map<string, number>()
  /** Subtasks the user asked to split (Faz 3): the running attempt is stopped and its session resumed with SPLIT_BRIEF. */
  private splitRequested = new Set<string>()
  /** Tasks created by a split: they may not split again (depth 1), so a run cannot fan out forever. */
  private splitChildren = new Set<string>()
  /** Models rejected (quota, limit, no access) during this run: no later subtask starts on them. */
  private dead = new Set<string>()
  /** Models out of quota with a known reset time (ms): tasks that have no other model wait until then. */
  private deadUntil = new Map<string, number>()
  /** Wakers of tasks waiting for a quota reset (cancel resolves them). */
  private quotaWaiters = new Map<string, () => void>()
  /** Subtasks the user asked to hand over → target model ref or "auto". */
  private handoverTo = new Map<string, string>()
  /** Index into `subtask.commands` where the current attempt started (handover briefs list only that attempt's commands). */
  private attemptCommandStart = new Map<string, number>()
  private waiters = new Map<string, (answer: string | null) => void>()
  /** Files the run touched so far (worker file events + host scan); the polish reviewer reads their diff instead of replaying everything. */
  private changedFiles: string[] = []
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
    this.order = run.plan.map((s) => s.id)
    this.routing = new Map(run.routing.map((r) => [r.subtaskId, r]))
    this.now = opts.now ?? Date.now
  }

  get snapshot(): Subtask[] {
    return this.order.map((id) => this.subtasks.get(id)!)
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    for (const h of this.handles.values()) h.cancel()
    this.handles.clear()
    for (const w of this.waiters.values()) w(null)
    this.waiters.clear()
    for (const w of this.quotaWaiters.values()) w()
    this.quotaWaiters.clear()
    for (const s of this.subtasks.values()) {
      if (!isTerminalState(s.state)) this.setState(s, "failed", s.progress, "cancelled")
    }
    this.bus.emit({ type: "run.cancelled", runId: this.run.id, at: this.now() })
  }

  /** Replace the shared project context for subsequent attempts (e.g. after the architecture task wrote the brief). */
  setContext(text: string | undefined): void {
    this.opts.context = text
  }

  /** Files touched so far (from the runs store); the polish review reads their diff instead of replaying the whole product. */
  setChangedFiles(files: string[]): void {
    this.changedFiles = Array.from(new Set(files))
  }

  /** Deliver the user's answer to a blocked subtask; its session resumes with the answer. */
  /**
   * Görevi böl (Faz 3): stop the running attempt of `subtaskId` and resume its session asking the worker to hand the
   * remaining work back as 2–3 independent sub-briefs, which then run in parallel as sibling tasks.
   */
  requestSplit(subtaskId: string): boolean {
    const subtask = this.subtasks.get(subtaskId)
    const handle = this.handles.get(subtaskId)
    if (!subtask || !handle || !subtask.attempts.at(-1)?.sessionId) return false
    this.splitRequested.add(subtaskId)
    this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId, line: { ts: this.now(), stream: "system", text: "✂ split requested — stopping this attempt and asking the worker to hand back the remaining work as parallel sub-tasks" } })
    handle.cancel()
    return true
  }

  /**
   * Görev aktarımı: stop the running attempt of `subtaskId` and continue it on `toModelId` (or the next model by pool
   * order) in a fresh session, with a HANDOVER brief describing what the previous worker already did.
   */
  requestHandover(subtaskId: string, toModelId?: string): boolean {
    const subtask = this.subtasks.get(subtaskId)
    if (!subtask || isTerminalState(subtask.state)) return false
    const log = (text: string) => this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId, line: { ts: this.now(), stream: "system", text } })
    if (toModelId) {
      // The user may pick a model outside the pool, but it must exist and a browser task needs a CLI that can open one.
      const model = this.models.get(toModelId)
      if (!model) {
        log(`⚠ handover refused: ${toModelId} is not a known model`)
        return false
      }
      if (subtask.needsBrowser && !providerInfo(model.providerId).capabilities.browser) {
        log(`⚠ handover refused: this task drives a browser and ${toModelId} cannot launch one`)
        return false
      }
    }
    const handle = this.handles.get(subtaskId)
    const waiter = this.waiters.get(subtaskId)
    const quota = this.quotaWaiters.get(subtaskId)
    this.handoverTo.set(subtaskId, toModelId ?? "auto")
    if (handle) {
      log(`↪ handover requested → ${toModelId ?? "next model"}: stopping this attempt; the next model continues from the repository state`)
      handle.cancel()
    } else if (waiter) {
      log(`↪ handover requested → ${toModelId ?? "next model"}: the question goes with the task; the next model continues from the repository state`)
      this.waiters.delete(subtaskId)
      waiter(null)
    } else if (quota) {
      // Waiting for a quota reset: stop waiting and continue on the chosen model now (2026-10-05).
      log(`↪ handover requested → ${toModelId ?? "next model"}: no more waiting for the quota reset`)
      quota()
    } else {
      // Queued / between attempts: the task starts (or continues) on the chosen model.
      log(`↪ handover requested → ${toModelId ?? "next model"}: the task will start on it`)
    }
    return true
  }

  /** Models this run will not start another attempt on (quota/limit/no access). */
  get deadModels(): string[] {
    return Array.from(this.dead)
  }

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
      deviations: [
        ...all.flatMap((s) => s.deviations.map((d) => `${s.title}: ${d}`)),
        ...all.filter((s) => this.polishIds.has(s.id) && s.state !== "completed").map((s) => `${s.title}: ${s.state} (${s.attempts.at(-1)?.error ?? "no result"})`),
      ],
      notes: all.flatMap((s) => (s.notes ?? []).map((d) => `${s.title}: ${d}`)),
      openQuestions: all.filter((s) => s.state === "blocked" && s.question).map((s) => `${s.title}: ${s.question}`),
      finishedAt: this.now(),
      polishScore: this.polishScore,
      polishNotes: this.polishNotes,
    }
  }

  async start(): Promise<"completed" | "failed" | "cancelled"> {
    this.bus.emit({ type: "run.started", runId: this.run.id, at: this.now() })
    this.bus.emit({ type: "run.status", runId: this.run.id, status: "running", at: this.now() })

    const limit = this.run.executionMode === "sequential" ? 1 : (this.opts.maxConcurrency ?? (this.run.executionMode === "staged" ? 4 : 8))
    await this.drain(limit)
    if (!this.cancelled && this.opts.polish && this.opts.polishModelId && this.snapshot.every((s) => s.state === "completed")) {
      await this.polishRound(limit)
    }
    return this.finish()
  }

  /** Schedule ready subtasks until every subtask is terminal (or the run is cancelled). */
  private async drain(limit: number): Promise<void> {
    const running = new Map<string, Promise<void>>()
    // Last (waiting, cap) pair reported: the "wait for a slot" note is emitted on change only.
    let lastCapped = { ready: 0, cap: 0 }
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
      const cap = Math.min(limit, Math.max(1, this.opts.concurrency?.() ?? Infinity))
      // One browser session per provider at a time: parallel browser checks on one account burn its quota together
      // (2026-10-05: three Antigravity sessions at once, the quota was gone in 25 min).
      const providerOf = (id: string) => (this.routing.get(id)?.primaryModelId ?? "").split(":")[0]
      const browserBusy = new Set([...running.keys()].filter((id) => this.subtasks.get(id)?.needsBrowser).map(providerOf))
      let heldForBrowser = 0
      const notStarted: Subtask[] = []
      for (const s of ready) {
        if (running.size >= cap) {
          notStarted.push(s)
          continue
        }
        if (s.needsBrowser && browserBusy.has(providerOf(s.id))) {
          heldForBrowser += 1
          continue
        }
        if (s.needsBrowser) browserBusy.add(providerOf(s.id))
        const p = this.execute(s.id).finally(() => running.delete(s.id))
        running.set(s.id, p)
      }
      // Visibility (2026-10-05): ready tasks held back by the HOST cap (not the run's own limit) are reported.
      const waiting = cap < limit ? notStarted.length : 0
      void heldForBrowser
      if (waiting !== lastCapped.ready || (waiting > 0 && cap !== lastCapped.cap)) {
        lastCapped = { ready: waiting, cap }
        this.bus.emit({ type: "run.capped", runId: this.run.id, ready: waiting, cap, at: this.now() })
        const first = notStarted[0]
        if (waiting > 0 && first) this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId: first.id, line: { ts: this.now(), stream: "system", text: `⏸ ${waiting} ready task(s) wait for a slot — host busy (cap ${cap})` } })
      }
      if (running.size === 0) break
      await Promise.race(running.values())
    }
    // Nothing runs and something still waits: a cycle or a dangling dependency would otherwise hang the run forever.
    if (!this.cancelled) {
      for (const s of this.snapshot) {
        if (isTerminalState(s.state)) continue
        const why = this.deadlockReason(s)
        this.setState(s, "failed", s.progress, why)
      }
    }
  }

  private finish(): "completed" | "failed" | "cancelled" {
    if (this.cancelled) return "cancelled"
    this.bus.emit({ type: "run.report", runId: this.run.id, report: this.report(), at: this.now() })
    // Polish tasks are best-effort: a crashed reviewer or an unfinished fix never turns a built project into a failed run.
    const ok = this.snapshot.filter((s) => !this.polishIds.has(s.id)).every((s) => s.state === "completed")
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
    let handoverFrom: HandoverFrom | undefined
    // A task with attempts from an earlier run (Kaldığı yerden devam / resume): its first attempt here continues that
    // work with a handover brief instead of starting from the task text alone.
    const prev = subtask.attempts.at(-1)
    if (prev) {
      handoverFrom = { modelId: prev.modelId, reason: `resumed after ${prev.outcome} on ${prev.modelId}`, lastMessage: subtask.summary ?? prev.error, commandsFrom: 0 }
      cause = "handover"
    }
    // Handed over while still queued: start on the chosen model.
    const queued = this.handoverTo.get(subtaskId)
    if (queued !== undefined) {
      this.handoverTo.delete(subtaskId)
      const target = this.handoverTarget(subtask, decision, [], modelId, queued)
      if (target) {
        if (prev) handoverFrom = { ...handoverFrom!, reason: `handed over by the user (earlier: ${prev.outcome} on ${prev.modelId})` }
        this.bus.emit({ type: "subtask.fallback", runId: this.run.id, subtaskId, fromModelId: modelId, toModelId: target, cause: "handover", reason: "handover requested", at: this.now() })
        modelId = target
      }
    }
    if (this.dead.has(modelId)) {
      const alt = nextModel(decision, [], this.run.modelPool, this.models.all(), Boolean(subtask.needsBrowser), { exclude: this.dead, lateral: true }) ?? this.outsidePoolBrowser(subtask, [modelId])
      if (alt) {
        this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId, line: { ts: this.now(), stream: "system", text: `↪ ${modelId} is out of quota in this run — starting on ${alt.modelId}` } })
        modelId = alt.modelId
      } else {
        const w = await this.waitForQuota(subtask, modelId, this.deadUntil.get(modelId))
        if (w === "handover") {
          const h = this.takeHandover(subtask, decision, tried, modelId, `handed over by the user while waiting for ${modelId}'s quota`, subtask.summary)
          if (!h) return
          handoverFrom = prev ? { ...h.from, lastMessage: h.from.lastMessage ?? prev.error } : h.from
          modelId = h.to
          cause = prev ? "handover" : cause
        } else if (!w) {
          if (!this.cancelled) this.setState(subtask, "failed", 0, `no usable model: ${modelId} is out of quota`)
          return
        }
      }
    }

    while (!this.cancelled) {
      attemptNo += 1
      let retriesOnModel = 0
      let continuations = 0
      const warm = cause === "initial" ? this.takeWarm(modelId) : undefined
      const briefOverride = cause === "handover" && handoverFrom ? await this.handoverBrief(subtask, modelId, handoverFrom) : undefined
      if (this.cancelled) return
      let result = await this.attempt(subtask, modelId, attemptNo, warm ? "warm" : cause, warm, undefined, briefOverride)
      // A warm session that could not be resumed (expired, CLI refused) costs one fresh attempt, never a model change.
      if (warm && !result.ok && !result.blocked && !result.timedOut && !this.cancelled) {
        attemptNo += 1
        this.bus.emit({ type: "subtask.retry", runId: this.run.id, subtaskId, modelId, attempt: attemptNo, reason: "warm session failed → fresh session", at: this.now() })
        result = await this.attempt(subtask, modelId, attemptNo, "retry")
      }
      // The worker asked the user something: block, wait for the answer, resume the same session.
      let questions = 0
      while (!result.ok && result.blocked && !this.cancelled) {
        const sessionId = subtask.attempts.at(-1)?.sessionId
        questions += 1
        if (!sessionId || questions > (this.opts.maxQuestions ?? 5)) break
        subtask.question = result.question
        this.setState(subtask, "blocked", subtask.progress)
        this.bus.emit({ type: "subtask.question", runId: this.run.id, subtaskId, question: result.question ?? "", at: this.now() })
        // Unattended: after `autoAnswerMs` the standard answer goes out and the session resumes (a real answer first wins).
        const autoMs = this.opts.autoAnswerMs ?? 0
        let autoTimer: ReturnType<typeof setTimeout> | undefined
        let auto = false
        const answer = await new Promise<string | null>((resolve) => {
          this.waiters.set(subtaskId, resolve)
          if (autoMs > 0) autoTimer = setTimeout(() => {
            if (this.waiters.get(subtaskId) !== resolve || this.cancelled) return
            this.waiters.delete(subtaskId)
            auto = true
            this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId, line: { ts: this.now(), stream: "system", text: `🤖 no answer for ${Math.max(1, Math.round(autoMs / 60000))} min — auto-answered: decide yourself and document` } })
            resolve(AUTO_ANSWER)
          }, autoMs)
        })
        if (autoTimer) clearTimeout(autoTimer)
        if (answer === null) {
          if (!this.handoverTo.has(subtaskId)) return
          result = { ok: false, summary: "handover", error: "handover requested", retryable: false, lastMessage: result.question }
          break
        }
        subtask.answers.push(answer)
        subtask.question = undefined
        this.bus.emit({ type: "subtask.answered", runId: this.run.id, subtaskId, answer, at: this.now(), ...(auto ? { auto: true } : {}) })
        attemptNo += 1
        result = await this.attempt(subtask, modelId, attemptNo, "answer", sessionId, answer)
      }
      // Görevi böl: the user stopped this attempt; resume its session with the split request.
      if (this.splitRequested.has(subtaskId) && !this.cancelled) {
        this.splitRequested.delete(subtaskId)
        const sessionId = subtask.attempts.at(-1)?.sessionId
        if (sessionId) {
          attemptNo += 1
          result = await this.attempt(subtask, modelId, attemptNo, "continue", sessionId, undefined, SPLIT_BRIEF)
        }
      }
      // A timeout is not a failure of the model: resume the same session and let it finish.
      while (!result.ok && result.timedOut && continuations < maxContinuations && !this.cancelled) {
        const sessionId = subtask.attempts.at(-1)?.sessionId
        if (!sessionId) break
        continuations += 1
        attemptNo += 1
        const act = result.activity ? ` (${result.activity.messages} msgs, ${result.activity.commands} cmds)` : ""
        this.bus.emit({ type: "subtask.retry", runId: this.run.id, subtaskId, modelId, attempt: attemptNo, reason: `timeout → continue session${act}`, at: this.now() })
        this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId, line: { ts: this.now(), stream: "system", text: `⏱ time limit reached — not a failure: resuming the same session where it left off (continuation ${continuations}/${maxContinuations})` } })
        result = await this.attempt(subtask, modelId, attemptNo, "continue", sessionId)
      }
      // Görev aktarımı (manual): the user stopped this attempt; continue on the chosen model.
      if (this.handoverTo.has(subtaskId) && !this.cancelled) {
        tried.push(modelId)
        const h = this.takeHandover(subtask, decision, tried, modelId, "handed over by the user", result.lastMessage)
        if (!h) return
        handoverFrom = h.from
        modelId = h.to
        cause = "handover"
        continue
      }
      // A model the CLI cannot use (no access, auth, quota) will not start working on the second try: skip straight to the next model.
      const rejected = (r: WorkerResult) => !r.ok && isModelRejected(r.error ?? "")
      while (!result.ok && result.retryable && !result.timedOut && !rejected(result) && retriesOnModel < maxRetries && !this.cancelled) {
        retriesOnModel += 1
        attemptNo += 1
        // A dead session (idle kill / limit with zero activity) is never resumed: the retry below starts a fresh session.
        if (result.activity && result.activity.events === 0 && /dead session|no output/i.test(result.error ?? "")) this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId, line: { ts: this.now(), stream: "system", text: "⚠ session produced nothing — not resuming it; starting a fresh attempt" } })
        this.bus.emit({ type: "subtask.retry", runId: this.run.id, subtaskId, modelId, attempt: attemptNo, reason: result.error ?? "failed", at: this.now() })
        result = await this.attempt(subtask, modelId, attemptNo, "retry")
      }
      if (result.notes?.length) subtask.notes = [...(subtask.notes ?? []), ...result.notes]
      if (result.deviations?.length || result.notes?.length) {
        subtask.deviations.push(...(result.deviations ?? []))
        this.bus.emit({ type: "subtask.deviations", runId: this.run.id, subtaskId, deviations: [...subtask.deviations], notes: [...(subtask.notes ?? [])], at: this.now() })
      }
      if (result.ok) {
        const sessionId = subtask.attempts.at(-1)?.sessionId
        if (sessionId && this.opts.warmSessions) this.warm.set(modelId, { sessionId, tokens: this.sessionTokens.get(sessionId) ?? 0 })
        if (result.split?.length) {
          if (this.splitChildren.has(subtaskId)) this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId, line: { ts: this.now(), stream: "system", text: "✂ split ignored: this task is already a split part (depth 1)" } })
          else this.splitInto(subtask, modelId, result.split)
        }
        subtask.summary = result.summary
        this.summaries.set(subtaskId, result.summary)
        this.bus.emit({ type: "subtask.summary", runId: this.run.id, subtaskId, summary: result.summary, at: this.now() })
        this.setState(subtask, "completed", 100)
        return
      }
      if (this.cancelled) return
      tried.push(modelId)
      const isReject = rejected(result)
      if (isReject) {
        this.dead.add(modelId)
        const until = quotaResetAt(result.error ?? "", this.now())
        if (until) this.deadUntil.set(modelId, until)
      }
      const next = nextModel(decision, tried, this.run.modelPool, this.models.all(), Boolean(subtask.needsBrowser), { exclude: this.dead, lateral: isReject }) ?? (isReject ? this.outsidePoolBrowser(subtask, tried) : null)
      // No other model can take it (2026-10-05: both browser checks of a run failed when the only browser-capable CLI in
      // the pool hit its quota): wait for the reset the error announced, then continue on the same model.
      if (isReject && !next && !result.blocked) {
        const w = await this.waitForQuota(subtask, modelId, this.deadUntil.get(modelId))
        if (w === true) {
          handoverFrom = { modelId, reason: `quota reset — continuing after "${(result.error ?? "").slice(0, 120)}"`, lastMessage: result.lastMessage, commandsFrom: this.attemptCommandStart.get(subtaskId) ?? 0 }
          cause = "handover"
          continue
        }
        if (w === "handover") {
          const h = this.takeHandover(subtask, decision, tried, modelId, `handed over by the user while waiting for ${modelId}'s quota ("${(result.error ?? "").slice(0, 120)}")`, result.lastMessage)
          if (!h) return
          handoverFrom = h.from
          modelId = h.to
          cause = "handover"
          continue
        }
        if (this.cancelled) return
      }
      if (result.blocked) {
        // Unanswered after the question budget: leave it blocked so the user can still answer later.
        this.setState(subtask, "failed", subtask.progress, result.question)
        return
      }
      if (!next || (!result.retryable && !result.timedOut && !rejected(result))) {
        this.setState(subtask, "failed", subtask.progress, result.error)
        return
      }
      const nextCause: Attempt["cause"] = isReject ? "handover" : next.cause
      if (isReject) handoverFrom = { modelId, reason: result.error ?? "quota/limit", lastMessage: result.lastMessage, commandsFrom: this.attemptCommandStart.get(subtaskId) ?? 0 }
      this.bus.emit({ type: "subtask.fallback", runId: this.run.id, subtaskId, fromModelId: modelId, toModelId: next.modelId, cause: nextCause === "handover" ? "handover" : next.cause, reason: result.error ?? "failed", at: this.now() })
      modelId = next.modelId
      cause = nextCause
    }
  }

  /**
   * A browser task whose pool has no browser-capable model left may use one from the catalog when the user allowed it
   * (Settings → browser fallback outside the pool). Highest tier first.
   */
  private outsidePoolBrowser(subtask: Subtask, tried: string[]): { modelId: string; cause: "fallback" } | null {
    if (!subtask.needsBrowser || !this.opts.browserFallbackOutsidePool) return null
    const rank: Record<string, number> = { fast: 0, strong: 1, frontier: 2 }
    const pick = this.models
      .all()
      .filter((m) => providerInfo(m.providerId).capabilities.browser)
      .map((m) => ({ ref: `${m.providerId}:${m.id}`, m }))
      .filter((x) => !this.dead.has(x.ref) && !tried.includes(x.ref) && !this.run.modelPool.includes(x.ref))
      .sort((a, b) => (rank[b.m.tier] ?? 0) - (rank[a.m.tier] ?? 0))[0]
    if (!pick) return null
    this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId: subtask.id, line: { ts: this.now(), stream: "system", text: `↪ no browser-capable model left in the pool — using ${pick.ref} from outside the pool (Settings: browser fallback)` } })
    return { modelId: pick.ref, cause: "fallback" }
  }

  /** Wait (state "waiting") until `modelId`'s quota resets; false when no reset time is known, it is too far away, or the run was cancelled. */
  private async waitForQuota(subtask: Subtask, modelId: string, until: number | undefined): Promise<boolean | "handover"> {
    const now = this.now()
    const max = this.opts.maxQuotaWaitMs ?? 6 * 3_600_000
    if (!until || until - now > max || this.cancelled) return false
    const at = new Date(until)
    const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`
    const reason = `${modelId} is out of quota and no other model in the pool can take this task — waiting until ${hhmm}`
    this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId: subtask.id, line: { ts: now, stream: "system", text: `⏳ ${reason}, then resuming on it` } })
    subtask.waitingUntil = until
    this.setState(subtask, "waiting", subtask.progress)
    this.bus.emit({ type: "subtask.deferred", runId: this.run.id, subtaskId: subtask.id, until, reason, at: now })
    // A minute of slack after long waits: providers reset on their own clock.
    const delay = Math.max(0, until - now) + (until - now > 60_000 ? 60_000 : 0)
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, delay)
      this.quotaWaiters.set(subtask.id, () => {
        clearTimeout(t)
        resolve()
      })
    })
    this.quotaWaiters.delete(subtask.id)
    subtask.waitingUntil = undefined
    const handedOver = this.handoverTo.has(subtask.id)
    this.bus.emit({ type: "subtask.deferred", runId: this.run.id, subtaskId: subtask.id, until: 0, reason: handedOver ? "handed over" : "quota reset", at: this.now() })
    if (this.cancelled) return false
    // The user handed the task over while it waited: the model stays dead until its own reset.
    if (handedOver) return "handover"
    this.dead.delete(modelId)
    this.deadUntil.delete(modelId)
    return true
  }

  /** Where a requested handover goes: the user's model, else (auto) the next usable model of the pool. */
  private handoverTarget(subtask: Subtask, decision: RoutingDecision, tried: string[], current: string, requested: string): string | undefined {
    if (requested !== "auto" && requested !== current) return requested
    return nextModel(decision, [...tried, current], this.run.modelPool, this.models.all(), Boolean(subtask.needsBrowser), { exclude: this.dead, lateral: true })?.modelId
  }

  /**
   * Consume a pending handover request (Görev aktarımı) for `subtask`: resolves the target, emits the fallback event and
   * returns where to continue. Fails the subtask when no model can take it (returns null).
   */
  private takeHandover(subtask: Subtask, decision: RoutingDecision, tried: string[], from: string, reason: string, lastMessage?: string): { to: string; from: HandoverFrom } | null {
    const requested = this.handoverTo.get(subtask.id) ?? "auto"
    this.handoverTo.delete(subtask.id)
    const target = this.handoverTarget(subtask, decision, tried, from, requested)
    if (!target) {
      this.setState(subtask, "failed", subtask.progress, "handover: no other model available")
      return null
    }
    this.bus.emit({ type: "subtask.fallback", runId: this.run.id, subtaskId: subtask.id, fromModelId: from, toModelId: target, cause: "handover", reason: "handover requested", at: this.now() })
    return { to: target, from: { modelId: from, reason, lastMessage, commandsFrom: this.attemptCommandStart.get(subtask.id) ?? 0 } }
  }

  /**
   * HANDOVER brief: the normal brief plus everything the next model needs to finish the task from where it stopped —
   * earlier attempts, questions and answers, notes, touched files, last commands and message, and the live repository
   * state (git status / diff stat / diff of the task's files) with a safety snapshot ref taken right now.
   */
  private async handoverBrief(subtask: Subtask, modelId: string, from: HandoverFrom): Promise<string> {
    const commands = subtask.commands.slice(from.commandsFrom).slice(-10)
    let repo: { text: string; snapshot?: string } | undefined
    try {
      repo = await this.opts.repoState?.(subtask.files.slice(-30))
    } catch (e) {
      repo = { text: `(repository state unavailable: ${e instanceof Error ? e.message : String(e)})` }
    }
    const attempts = subtask.attempts.slice(-5).map((a) => `- ${a.modelId} · ${a.cause} · ${a.outcome}${a.error ? ` — ${a.error.replace(/\s+/g, " ").slice(0, 200)}` : ""}`)
    const qa = [...subtask.answers.map((answer, idx) => ({ question: idx === subtask.answers.length - 1 && subtask.question ? subtask.question : `question ${idx + 1}`, answer })), ...(subtask.question && !subtask.answers.length ? [{ question: subtask.question }] : [])]
    this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId: subtask.id, line: { ts: this.now(), stream: "system", text: `↪ handed over "${subtask.title}" → ${modelId}${repo?.snapshot ? ` (repo snapshot ${repo.snapshot})` : ""}` } })
    return `${this.brief(subtask, modelId)}\n\n${handoverBlock({ fromModel: from.modelId, reason: from.reason, files: subtask.files, commands, lastMessage: from.lastMessage, attempts, qa, notes: subtask.notes, deviations: subtask.deviations, repoState: repo?.text, snapshot: repo?.snapshot })}`
  }

  /** Materialize a worker's SILENT_SPLIT: sibling tasks on the same model; whoever depended on the parent now also waits for them. */
  private splitInto(parent: Subtask, modelId: string, briefs: string[]): void {
    const items = briefs.slice(0, 3)
    const children = items.map((text) => {
      const title = text.split(/\.\s|\n/)[0].replace(/\s*Owns:.*$/i, "").trim().slice(0, 80) || "Split task"
      const description = `${text}\n\nThis is part of "${parent.title}", which the previous worker started and split; the repository already contains its earlier work. Do only this part and keep the checks green for your paths.`
      const child = this.addSubtask(parent.kind, title, description, modelId, 1, parent.timeoutSecs, false)
      this.splitChildren.add(child.id)
      return child
    })
    for (const s of this.subtasks.values()) {
      if (s.id !== parent.id && s.dependsOn.includes(parent.id)) for (const c of children) if (!s.dependsOn.includes(c.id)) s.dependsOn.push(c.id)
    }
    this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId: parent.id, line: { ts: this.now(), stream: "system", text: `✂ split into ${children.length} parallel tasks: ${children.map((c) => c.title).join(" · ")}` } })
  }

  private addSubtask(kind: Subtask["kind"], title: string, description: string, modelId: string, weight: 1 | 2 | 3 = 2, timeoutSecs?: number, polish = true): Subtask {
    const s: Subtask = {
      timeoutSecs,
      effort: this.run.effort,
      id: `st_${this.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      runId: this.run.id,
      kind,
      title,
      description,
      dependsOn: [],
      state: "waiting",
      attempts: [],
      files: [],
      commands: [],
      weight,
      progress: 0,
      lastUpdate: this.now(),
      answers: [],
      deviations: [],
    }
    this.subtasks.set(s.id, s)
    this.order.push(s.id)
    if (polish) this.polishIds.add(s.id)
    this.routing.set(s.id, { subtaskId: s.id, kind, primaryModelId: modelId, fallbackModelIds: [], reason: polish ? "polish" : "split", score: 1 })
    this.bus.emit({ type: "subtask.added", runId: this.run.id, subtask: structuredClone(s), at: this.now() })
    return s
  }

  /**
   * Polish round: a frontier reviewer scores the repository against the spec and the kit checklist,
   * then up to three concrete fix tasks run. One round only; the score is kept in the report.
   */
  private async polishRound(limit: number): Promise<void> {
    const modelId = this.opts.polishModelId!
    const review = this.addSubtask(
      "review",
      "Polish review",
      [
        "You are the POLISH REVIEWER. Do not change files. Compare the repository with the SPEC and the QUALITY CHECKLIST above.",
        // Diff polish (2026-09-30): the run's own browser tasks already played the product; replaying it here cost 20+ minutes.
        ...(this.changedFiles.length
          ? [
              `Changed files (${this.changedFiles.length}) — review their diff (git diff / read them), not the whole repository:\n${this.changedFiles.slice(0, 120).map((f) => `- ${f}`).join("\n")}\n`,
              "Look at the screenshots the verification tasks saved under .silent/tmp/shots (and .silent/tmp/shots-*) before judging visuals; the browser tasks already played the product, so play only what no browser task covered. Run the checks once (typecheck, tests, build).",
            ]
          : [
              "Run the project's own checks (install, typecheck, tests, build) and exercise the product the way a demanding user would (start it; for web/game projects open the built app in a real browser if this environment allows it and play/click through the main flows).",
            ]),
        "Then reply with: (a) 5–10 lines of what is strong and what is weak, (b) one line `SILENT_SCORE: <0-10>` (10 = ship-ready, delightful; 6 = works but rough; 3 = demo quality), (c) `SILENT_FIXES:` followed by at most 3 bullet points — each a concrete, self-contained task a worker can finish in under 30 minutes with the largest impact on the score (or `SILENT_FIXES: none` when the score is 9 or above), (d) `SILENT_DEVIATIONS: none`.",
      ].join(" "),
      modelId,
      2,
      // A polish review plays the product (build, browser, bots): the 15-minute default for "review" is too short.
      30 * 60,
    )
    await this.drain(limit)
    if (this.cancelled) return
    const summary = this.summaries.get(review.id) ?? ""
    const score = Number(/SILENT_SCORE:\**\s*(\d+(?:\.\d+)?)/i.exec(summary)?.[1])
    this.polishScore = Number.isFinite(score) ? score : undefined
    const fixesBlock = /SILENT_FIXES:\**\s*([\s\S]*?)(?:\n\s*\n|\**SILENT_DEVIATIONS:|$)/i.exec(summary)?.[1] ?? ""
    let fixes = fixesBlock
      .split("\n")
      .map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
      .filter((l) => l && !/^none$/i.test(l))
      .slice(0, 3)
    // Reviewers sometimes ignore the SILENT_FIXES block and list findings as "- [P1] …" review comments
    // (Loki run, 2026-09-25: score 6, three concrete defects, zero fix tasks). Fall back to those.
    if (!fixes.length) {
      fixes = summary
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^[-*•]\s*\[P[0-3]\]/i.test(l))
        .sort((a, b) => Number(/\[P(\d)\]/i.exec(a)?.[1] ?? 9) - Number(/\[P(\d)\]/i.exec(b)?.[1] ?? 9))
        .map((l) => l.replace(/^[-*•]\s*\[P\d\]\s*/i, "").replace(/\s+—\s+\/\S+/, "").trim())
        .filter(Boolean)
        .slice(0, 3)
    }
    this.polishNotes = summary.replace(/SILENT_(SCORE|FIXES|DEVIATIONS):[\s\S]*$/i, "").trim().slice(0, 1500)
    if (review.state !== "completed" || !fixes.length || (this.polishScore ?? 0) >= 9) return
    for (const fix of fixes) {
      const kind: Subtask["kind"] = /test|spec|coverage/i.test(fix) ? "tests" : /ui|visual|render|css|layout|animation|screen|hud|menu|sprite|sound|audio|juice|feel/i.test(fix) ? "frontend" : "backend"
      const title = fix.replace(/`/g, "").split(/(?<=[.!?])\s/)[0].slice(0, 80)
      this.addSubtask(kind, `Fix: ${title}`, `Polish fix from the review (score ${this.polishScore ?? "?"}/10). ${fix} Verify it works end to end and keep every check green.`, modelId, 1, 25 * 60)
    }
    await this.drain(limit)
  }

  /** Warm session ceiling: past this many consumed tokens the session's context is too full to host another task safely. */
  static readonly WARM_SESSION_MAX_TOKENS = 120_000

  /** Take (and reserve) the warm session of `modelId` if the CLI can resume and the session is still light. */
  private takeWarm(modelId: string): string | undefined {
    if (!this.opts.warmSessions) return undefined
    const w = this.warm.get(modelId)
    if (!w) return undefined
    this.warm.delete(modelId)
    const providerId = (this.models.get(modelId)?.providerId ?? parseModelRef(modelId).providerId) as ProviderId
    if (!providerInfo(providerId).capabilities.resume || w.tokens > Executor.WARM_SESSION_MAX_TOKENS) return undefined
    return w.sessionId
  }

  private attempt(subtask: Subtask, modelId: string, n: number, cause: Attempt["cause"], resumeSessionId?: string, answer?: string, briefOverride?: string): Promise<WorkerResult> {
    // A cancelled run starts nothing new (2026-10-05: a warm-session retry after cancel started a worker nobody could stop).
    if (this.cancelled) return Promise.resolve({ ok: false, summary: "cancelled", error: "cancelled", retryable: false })
    const attempt: Attempt = { n, modelId, startedAt: this.now(), outcome: "running", cause, sessionId: resumeSessionId }
    subtask.attempts.push(attempt)
    this.attemptCommandStart.set(subtask.id, subtask.commands.length)
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
      usage: (tokens, costUsd) => {
        if (attempt.sessionId) this.sessionTokens.set(attempt.sessionId, (this.sessionTokens.get(attempt.sessionId) ?? 0) + tokens)
        this.bus.emit({ type: "worker.usage", runId: this.run.id, subtaskId: subtask.id, tokens, costUsd, at: this.now() })
      },
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
      brief: briefOverride !== undefined
        ? briefOverride
        : answer !== undefined
        ? `The user answered your question: ${answer}\n\nContinue the task with this answer. When done, reply with a concise summary, then a "SILENT_DEVIATIONS:" list (or "SILENT_DEVIATIONS: none").`
        : cause === "warm"
          ? `NEW TASK (unrelated to the previous one in this session — forget its instructions, keep what you learned about the repository):\n\n${this.brief(subtask, modelId)}`
          : resumeSessionId
          ? `You were interrupted by a time limit. Continue exactly where you left off, finish the remaining work, then reply with a concise summary of what you changed and how you verified it, followed by a "SILENT_DEVIATIONS:" list (or "SILENT_DEVIATIONS: none"). ${SPLIT_HINT}`
          : this.brief(subtask, modelId),
      repoPath: this.run.repoPath,
      sandbox: this.opts.sandbox ?? "workspace-write",
      network: this.opts.network ?? (this.opts.sandbox ?? "workspace-write") === "workspace-write",
      effort: (() => {
        const wanted = subtask.effort ?? effortFor(subtask.kind, this.run.costMode, model?.tier)
        return clampEffort((model?.providerId ?? parseModelRef(modelId).providerId) as ProviderId, wanted) ?? wanted
      })(),
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

  /** Every worker sees the whole plan: sibling tasks, their state and their owned paths (prevents path drift between brief and plan). */
  private planOverview(current: Subtask): string {
    const rows = this.snapshot
      .filter((s) => s.id !== current.id)
      .map((s) => {
        const owns = /Owns:\s*([^\n.]+(?:\.[^\n]*)?)/i.exec(s.description)?.[1]?.trim()
        return `- [${s.state}] ${s.title}${owns ? ` — owns ${owns.slice(0, 160)}` : ""}`
      })
    if (!rows.length) return ""
    const mine = /Owns:\s*([^\n]+)/i.exec(current.description)?.[1]?.trim()
    return `Run plan (${this.snapshot.length} tasks; yours: "${current.title}"${mine ? `, owns ${mine.slice(0, 200)}` : ""}):\n${rows.join("\n").slice(0, 2000)}\nUse these exact paths when you reference other modules (import paths, docs, briefs). Wiring your area into the app is part of YOUR task; the integration task only stitches areas together.`
  }

  /** The one-line check a worker runs instead of the whole suite: the planner's `verify`, else derived from its ownership line. */
  private verifyLine(subtask: Subtask): string {
    if (subtask.verify?.trim()) return subtask.verify.trim()
    // Up to the end of the sentence: "Owns: src/a/**, tests/a/**. Implement…" → "src/a/**, tests/a/**" (dots inside file names survive).
    const owns = /Owns:\s*([^\n]*?)(?=\.\s|\.$|\n|$)/i.exec(subtask.description)?.[1] ?? ""
    const paths = owns
      .split(/[,;]/)
      .map((p) => p.trim().replace(/\/\*\*$/, "").replace(/\/\*$/, "").replace(/\.$/, ""))
      .filter((p) => p && !p.includes(" ") && /[\w/.-]+/.test(p))
    return paths.length ? `npx vitest run ${paths.join(" ")} && npx tsc --noEmit` : "the project's typecheck and the tests under the paths you own"
  }

  /**
   * Brief layout is prompt-cache friendly (Faz 3, 2026-09-30): first the run-wide prefix that is byte-identical for
   * every task of the run (spec, kit, context, static rules), then the provider-dependent notes, and only then the
   * task-specific part after a `# TASK` marker. Providers with prefix caching (Codex, Claude) reuse the long prefix.
   */
  private brief(subtask: Subtask, modelId: string): string {
    const model = this.models.get(modelId)
    const upstream = subtask.dependsOn.map((d) => this.summaries.get(d)).filter(Boolean)
    const providerId = (model?.providerId ?? parseModelRef(modelId).providerId) as ProviderId
    const caps = providerInfo(providerId).capabilities
    const prefix = [
      "You are a worker in a Silent orchestration run.",
      this.opts.gatewayBrief ?? "",
      this.opts.spec ? `SPEC (build exactly this; the user judges the result against it):\n${this.opts.spec.slice(0, 6000)}` : "",
      (this.opts.kitBrief ?? "").slice(0, 3500),
      this.opts.context ? `PROJECT CONTEXT (already discovered — do not re-scan the repository for this):\n${this.opts.context.slice(0, 14000)}` : "",
      (this.opts.network ?? (this.opts.sandbox ?? "workspace-write") === "workspace-write") ? "Environment: the shell has outbound network access (package installs, git fetch and HTTP work)." : "Environment: the shell has NO network access. Do not attempt installs or downloads; if the task needs them, ask with SILENT_QUESTION.",
      "Scratch files (bots, probes, screenshots): write them under <repo>/.silent/tmp/ (git-ignored) or the OS temp dir; writes elsewhere are denied.",
      WORKER_FOREGROUND_RULE,
      "Editing: prefer your native file-edit tool (Codex: apply_patch; Claude: Edit/Write) over shell heredocs, so every changed file is tracked and reviewable.",
      "Module shadowing: a file `x.ts` beside a folder `x/` wins the import `./x` and silently replaces `x/index.ts`. Never create such a file; when you integrate or review, look for these pairs and for dead scaffold that shadows a real module, and delete them.",
      CONVERTER_TOOLKIT,
      shellNotes(),
      "Verification scope: other tasks may be editing their own paths right now, so the GLOBAL typecheck/test/build can be red for reasons outside your paths. Verify YOUR paths (filter tsc output to them, run the tests under your directories). Mention sibling breakage as a note, not as your deviation, and never fix files you do not own. The integration task runs the full suite at the end.",
      "Rules: (1) Do exactly what the request says. If you cannot or should not do something the user asked for (policy, legal, access, missing information, ambiguity), DO NOT silently do something else: stop and write one line `SILENT_QUESTION: <your question to the user>` and end your reply; the user will answer and you will continue. (2) When you finish, reply with a concise summary (at most 15 lines) of what you changed and how you verified it, then a section `SILENT_DEVIATIONS:` listing ONLY what you did differently from the request or could not do (or `SILENT_DEVIATIONS: none`), then a section `SILENT_NOTES:` with information for the user and other tasks — sibling modules that were red at the time, follow-ups, design decisions, additive contract extensions (or `SILENT_NOTES: none`). Notes are not deviations. Environment limits stated above (no browser in this sandbox, network or permission limits) are NEVER deviations: mention them under SILENT_NOTES only. (3) Other tasks may be running IN PARALLEL in this same repository. Edit only the files/directories your task owns (named in the task); never overwrite, delete or rewrite files that belong to another task. If a shared contract/type must change, make the change ADDITIVE (no renames, no removals) so other workers keep compiling, and list it under SILENT_DEVIATIONS. If you truly must change another task's file, ask with SILENT_QUESTION instead.",
    ]
    const providerNotes = [
      caps.browser ? "A real browser can be launched here (Playwright/Chromium) when the task needs it." : "This sandbox CANNOT launch a browser (Chromium/Playwright fail on mach-port check-in); local dev servers, curl and headless Node checks work. Do not retry browser launches; report it under SILENT_DEVIATIONS.",
      ...(caps.image ? [IMAGE_TOOL_HINT] : []),
      // 2026-10-05: two Antigravity browser checks made ~150 tool calls each in 20 min, polling background tasks with
      // `manage_task Action=status`, and exhausted the account quota for four hours.
      ...(modelId.startsWith("antigravity:")
        ? ["Antigravity: do NOT start background tasks with manage_task and never poll a task's status — every tool call costs quota. Run commands yourself in the foreground with a cap (`timeout 600 npx playwright test <one spec>`), read only the files you need, and stop as soon as the check is answered."]
        : []),
    ]
    const task = [
      "# TASK",
      `You are ${model?.displayName ?? modelId}, working as the ${subtask.kind} worker.`,
      `Task: ${subtask.title}`,
      subtask.description,
      upstream.length ? `Upstream results:\n${upstream.map((u) => `- ${u}`).join("\n")}` : "",
      this.planOverview(subtask),
      `Verify with: \`${this.verifyLine(subtask)}\` — run the full suite only if this is the integration task.`,
    ]
    return [...prefix, ...providerNotes, ...task]
      .filter(Boolean)
      .join("\n\n")
  }

  private setState(subtask: Subtask, state: WorkerState, progress?: number, error?: string): void {
    subtask.state = state
    if (progress !== undefined) subtask.progress = progress
    subtask.lastUpdate = this.now()
    if (error && state === "failed") subtask.summary = subtask.summary ?? error
    this.bus.emit({ type: "subtask.state", runId: this.run.id, subtaskId: subtask.id, state, progress: subtask.progress, at: this.now(), error: state === "failed" ? (error ?? subtask.summary ?? "failed") : undefined })
  }

  /** Why a non-terminal subtask can never start: a dependency cycle (named by titles) or a dependency that is not in the plan. */
  private deadlockReason(start: Subtask): string {
    const missing = start.dependsOn.filter((d) => !this.subtasks.has(d))
    if (missing.length) return `unresolved dependency: ${missing.join(", ")}`
    const path: string[] = []
    const seen = new Set<string>()
    const walk = (id: string): boolean => {
      if (id === start.id && path.length) return true
      if (seen.has(id)) return false
      seen.add(id)
      const s = this.subtasks.get(id)
      if (!s) return false
      path.push(s.title)
      for (const d of s.dependsOn) if (walk(d)) return true
      path.pop()
      return false
    }
    return walk(start.id) ? `dependency cycle: ${[...path, start.title].join(" → ")}` : "blocked by a dependency that never completed"
  }
}
