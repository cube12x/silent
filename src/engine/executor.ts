import { CONVERTER_TOOLKIT } from "./blueprint/prompt"
import { shellNotes } from "@/lib/platform"
import { isModelRejected } from "./modelErrors"
import { providerInfo } from "@/providers/registry"
import { parseModelRef, type ProviderId } from "@/domain"
import type { Attempt, ProviderModel, RoutingDecision, RunReport, SilentCodeRun, Subtask, WorkerState } from "@/domain"
import { isTerminalState } from "@/domain"
import { EventBus } from "./events"
import { nextModel } from "./router"
import { ModelIndex } from "./capabilities"
import { clampEffort, effortFor, timeoutFor } from "./effort"
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
        this.bus.emit({ type: "worker.log", runId: this.run.id, subtaskId, line: { ts: this.now(), stream: "system", text: `⏱ time limit reached — not a failure: resuming the same session where it left off (continuation ${continuations}/${maxContinuations})` } })
        result = await this.attempt(subtask, modelId, attemptNo, "continue", sessionId)
      }
      // A model the CLI cannot use (no access, auth, quota) will not start working on the second try: skip straight to the next model.
      const rejected = (r: WorkerResult) => !r.ok && isModelRejected(r.error ?? "")
      while (!result.ok && result.retryable && !result.timedOut && !rejected(result) && retriesOnModel < maxRetries && !this.cancelled) {
        retriesOnModel += 1
        attemptNo += 1
        this.bus.emit({ type: "subtask.retry", runId: this.run.id, subtaskId, modelId, attempt: attemptNo, reason: result.error ?? "failed", at: this.now() })
        result = await this.attempt(subtask, modelId, attemptNo, "retry")
      }
      if (result.notes?.length) subtask.notes = [...(subtask.notes ?? []), ...result.notes]
      if (result.deviations?.length || result.notes?.length) {
        subtask.deviations.push(...(result.deviations ?? []))
        this.bus.emit({ type: "subtask.deviations", runId: this.run.id, subtaskId, deviations: [...subtask.deviations], notes: [...(subtask.notes ?? [])], at: this.now() })
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
      const next = nextModel(decision, tried, this.run.modelPool, this.models.all(), Boolean(subtask.needsBrowser))
      if (result.blocked) {
        // Unanswered after the question budget: leave it blocked so the user can still answer later.
        this.setState(subtask, "failed", subtask.progress, result.question)
        return
      }
      if (!next || (!result.retryable && !result.timedOut && !rejected(result))) {
        this.setState(subtask, "failed", subtask.progress, result.error)
        return
      }
      this.bus.emit({ type: "subtask.fallback", runId: this.run.id, subtaskId, fromModelId: modelId, toModelId: next.modelId, cause: next.cause, reason: result.error ?? "failed", at: this.now() })
      modelId = next.modelId
      cause = next.cause
    }
  }

  private addSubtask(kind: Subtask["kind"], title: string, description: string, modelId: string, weight: 1 | 2 | 3 = 2, timeoutSecs?: number): Subtask {
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
    this.polishIds.add(s.id)
    this.routing.set(s.id, { subtaskId: s.id, kind, primaryModelId: modelId, fallbackModelIds: [], reason: "polish", score: 1 })
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
        "Run the project's own checks (install, typecheck, tests, build) and exercise the product the way a demanding user would (start it; for web/game projects open the built app in a real browser if this environment allows it and play/click through the main flows).",
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
    return `Run plan (${this.snapshot.length} tasks; yours: "${current.title}"${mine ? `, owns ${mine.slice(0, 200)}` : ""}):\n${rows.join("\n").slice(0, 2000)}\nUse these exact paths when you reference other modules (import paths, docs, briefs).`
  }

  private brief(subtask: Subtask, modelId: string): string {
    const model = this.models.get(modelId)
    const upstream = subtask.dependsOn.map((d) => this.summaries.get(d)).filter(Boolean)
    return [
      `You are ${model?.displayName ?? modelId}, working as the ${subtask.kind} worker in a Silent orchestration run.`,
      this.opts.gatewayBrief ?? "",
      this.opts.spec ? `SPEC (build exactly this; the user judges the result against it):\n${this.opts.spec.slice(0, 6000)}` : "",
      (this.opts.kitBrief ?? "").slice(0, 3500),
      this.opts.context ? `PROJECT CONTEXT (already discovered — do not re-scan the repository for this):\n${this.opts.context.slice(0, 8000)}` : "",
      `Task: ${subtask.title}`,
      subtask.description,
      upstream.length ? `Upstream results:\n${upstream.map((u) => `- ${u}`).join("\n")}` : "",
      this.planOverview(subtask),
      (this.opts.network ?? (this.opts.sandbox ?? "workspace-write") === "workspace-write") ? "Environment: the shell has outbound network access (package installs, git fetch and HTTP work)." : "Environment: the shell has NO network access. Do not attempt installs or downloads; if the task needs them, ask with SILENT_QUESTION.",
      "Scratch files (bots, probes, screenshots): write them under <repo>/.silent/tmp/ (git-ignored) or the OS temp dir; writes elsewhere are denied.",
      "Editing: prefer your native file-edit tool (Codex: apply_patch; Claude: Edit/Write) over shell heredocs, so every changed file is tracked and reviewable.",
      "Module shadowing: a file `x.ts` beside a folder `x/` wins the import `./x` and silently replaces `x/index.ts`. Never create such a file; when you integrate or review, look for these pairs and for dead scaffold that shadows a real module, and delete them.",
      CONVERTER_TOOLKIT,
      shellNotes(),
      providerInfo((model?.providerId ?? parseModelRef(modelId).providerId) as ProviderId).capabilities.browser ? "A real browser can be launched here (Playwright/Chromium) when the task needs it." : "This sandbox CANNOT launch a browser (Chromium/Playwright fail on mach-port check-in); local dev servers, curl and headless Node checks work. Do not retry browser launches; report it under SILENT_DEVIATIONS.",
      ...(providerInfo((model?.providerId ?? parseModelRef(modelId).providerId) as ProviderId).capabilities.image ? ["You have a built-in raster IMAGE GENERATION tool (generate_image / image_gen, plus image_edit where available). For artwork (sprites, sprite sheets, backgrounds, portraits, key art, UI cards) use it and save the PNG files under the project's assets folder, then wire them into the code; prefer generated images over hand-coding pixel data when the task asks for drawn art. Keep a consistent style across the images you generate (same palette, outline weight and era)."] : []),
      "Verification scope: other tasks may be editing their own paths right now, so the GLOBAL typecheck/test/build can be red for reasons outside your paths. Verify YOUR paths (filter tsc output to them, run the tests under your directories). Mention sibling breakage as a note, not as your deviation, and never fix files you do not own. The integration task runs the full suite at the end.",
      "Rules: (1) Do exactly what the request says. If you cannot or should not do something the user asked for (policy, legal, access, missing information, ambiguity), DO NOT silently do something else: stop and write one line `SILENT_QUESTION: <your question to the user>` and end your reply; the user will answer and you will continue. (2) When you finish, reply with a concise summary of what you changed and how you verified it, then a section `SILENT_DEVIATIONS:` listing ONLY what you did differently from the request or could not do (or `SILENT_DEVIATIONS: none`), then a section `SILENT_NOTES:` with information for the user and other tasks — sibling modules that were red at the time, follow-ups, design decisions, additive contract extensions (or `SILENT_NOTES: none`). Notes are not deviations. Environment limits stated above (no browser in this sandbox, network or permission limits) are NEVER deviations: mention them under SILENT_NOTES only. (3) Other tasks may be running IN PARALLEL in this same repository. Edit only the files/directories your task owns (named in the task); never overwrite, delete or rewrite files that belong to another task. If a shared contract/type must change, make the change ADDITIVE (no renames, no removals) so other workers keep compiling, and list it under SILENT_DEVIATIONS. If you truly must change another task's file, ask with SILENT_QUESTION instead.",
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
