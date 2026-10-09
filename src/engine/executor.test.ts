import { describe, expect, it } from "vitest"
import type { SilentCodeRun, SubtaskKind } from "@/domain"
import { EventBus, type RunEvent } from "./events"
import { Executor } from "./executor"
import { planSubtasks } from "./planner"
import { routeSubtasks } from "./router"
import { estimateRun } from "./estimate"
import { TEST_MODELS, TEST_POOL } from "./testModels"
import type { Worker, WorkerHandle, WorkerJob, WorkerSink } from "./workers/Worker"

/** Test double: resolves immediately with scripted outcomes per kind. */
class ScriptedWorker implements Worker {
  readonly id = "scripted"
  private cursor = new Map<SubtaskKind, number>()
  private readonly script: Partial<Record<SubtaskKind, Array<"ok" | "fail" | "reject">>>
  private readonly hang: boolean
  constructor(script: Partial<Record<SubtaskKind, Array<"ok" | "fail" | "reject">>> = {}, hang = false) {
    this.script = script
    this.hang = hang
  }
  supports() {
    return true
  }
  start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
    let cancelled = false
    const outcome = (() => {
      const s = this.script[job.subtask.kind]
      if (!s?.length) return "ok"
      const i = this.cursor.get(job.subtask.kind) ?? 0
      this.cursor.set(job.subtask.kind, i + 1)
      return s[Math.min(i, s.length - 1)]
    })()
    sink.state("coding", 50)
    sink.command(`echo ${job.subtask.kind}`)
    sink.log(`running ${job.modelId}`)
    const done = this.hang
      ? new Promise<{ ok: boolean; summary: string; error?: string; retryable?: boolean }>((resolve) => {
          const t = setInterval(() => {
            if (cancelled) {
              clearInterval(t)
              resolve({ ok: false, summary: "cancelled", error: "cancelled", retryable: false })
            }
          }, 5)
        })
      : Promise.resolve(
          outcome === "ok"
            ? { ok: true, summary: `${job.subtask.kind} done by ${job.modelId}` }
            : outcome === "reject"
              ? { ok: false, summary: "failed", error: `exit_nonzero: provider.auth_error: 401 Your current subscription does not have access to ${job.modelId}`, retryable: false }
              : { ok: false, summary: "failed", error: `${job.subtask.kind} failed`, retryable: true },
        )
    return { done, cancel: () => (cancelled = true) }
  }
}

function makeRun(prompt: string, pool = TEST_POOL, mode: SilentCodeRun["executionMode"] = "parallel"): SilentCodeRun {
  const plan = planSubtasks({ prompt }, "run_1")
  const routing = routeSubtasks({ subtasks: plan, pool, models: TEST_MODELS, costMode: "balanced" })
  return { id: "run_1", title: prompt, prompt, modelPool: pool, executionMode: mode, costMode: "balanced", plan, routing, status: "planned", estimate: estimateRun(plan, routing, mode), createdAt: 0 }
}

function collect(bus: EventBus) {
  const events: RunEvent[] = []
  bus.subscribe((e) => events.push(e))
  return events
}

/** Each attempt takes `ms` before succeeding, so a hold can land while a task runs. */
class SlowWorker implements Worker {
  readonly id = "slow"
  started: string[] = []
  private readonly ms: number
  constructor(ms: number) {
    this.ms = ms
  }
  supports() {
    return true
  }
  start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
    this.started.push(job.subtask.id)
    sink.state("coding", 50)
    const done = new Promise<{ ok: boolean; summary: string }>((resolve) => setTimeout(() => resolve({ ok: true, summary: `${job.subtask.kind} done` }), this.ms))
    return { done, cancel: () => undefined }
  }
}

describe("executor", () => {
  it("holdNewTasks (Bütçe) lets the running task finish, starts nothing else and fails the rest with the reason", async () => {
    const run = makeRun("Add a real-time notification system with tests", TEST_POOL, "sequential")
    expect(run.plan.length).toBeGreaterThan(1)
    const bus = new EventBus()
    const events = collect(bus)
    const worker = new SlowWorker(30)
    const exec = new Executor(run, () => worker, bus, { models: TEST_MODELS, polish: true, polishModelId: TEST_POOL[0] })
    const outcome = exec.start()
    await new Promise((r) => setTimeout(r, 10))
    exec.holdNewTasks("budget 1.5M reached at 1.6M")
    expect(await outcome).toBe("failed")
    // The first task was running: it completed and its work is kept; nothing else ever started.
    expect(worker.started).toHaveLength(1)
    const snap = exec.snapshot
    expect(snap[0]!.state).toBe("completed")
    expect(snap.slice(1).every((s) => s.state === "failed")).toBe(true)
    const failed = events.find((e) => e.type === "subtask.state" && e.subtaskId === snap[1]!.id && e.state === "failed")
    expect(failed && failed.type === "subtask.state" ? failed.error : "").toContain("budget 1.5M")
    expect(events.some((e) => e.type === "worker.log" && e.line.text.includes("running tasks finish"))).toBe(true)
    expect(events.some((e) => e.type === "run.failed")).toBe(true)
    expect(events.some((e) => e.type === "subtask.added")).toBe(false) // no polish round under a hold
  })
  it("completes a run in dependency order", async () => {
    const run = makeRun("Add a real-time notification system with tests")
    const bus = new EventBus()
    const events = collect(bus)
    const exec = new Executor(run, () => new ScriptedWorker(), bus, { models: TEST_MODELS })
    expect(await exec.start()).toBe("completed")
    const completedAt = new Map<string, number>()
    events.forEach((e, i) => e.type === "subtask.state" && e.state === "completed" && completedAt.set(e.subtaskId, i))
    for (const s of run.plan) for (const d of s.dependsOn) expect(completedAt.get(d)!).toBeLessThan(completedAt.get(s.id)!)
    expect(events.at(-1)?.type).toBe("run.completed")
  })

  it("retries once, then falls back to another CLI model", async () => {
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra", "claude:sonnet", "claude:opus"], "sequential")
    const bus = new EventBus()
    const events = collect(bus)
    const worker = new ScriptedWorker({ backend: ["fail", "fail", "ok"] })
    const exec = new Executor(run, () => worker, bus, { maxRetriesPerModel: 1, models: TEST_MODELS })
    expect(await exec.start()).toBe("completed")
    const backend = exec.snapshot.find((s) => s.kind === "backend")!
    expect(backend.attempts.map((a) => a.cause)).toEqual(["initial", "retry", "fallback"])
    expect(backend.attempts[2].modelId.split(":")[0]).not.toBe(backend.attempts[0].modelId.split(":")[0])
    expect(events.some((e) => e.type === "subtask.fallback")).toBe(true)
  })

  it("a model the CLI cannot use (401/no access) is skipped at once: no same-model retry, straight to the next model", async () => {
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra", "claude:sonnet", "claude:opus"], "sequential")
    const bus = new EventBus()
    const events = collect(bus)
    const worker = new ScriptedWorker({ backend: ["reject", "ok"] })
    const exec = new Executor(run, () => worker, bus, { maxRetriesPerModel: 1, models: TEST_MODELS })
    expect(await exec.start()).toBe("completed")
    const backend = exec.snapshot.find((s) => s.kind === "backend")!
    expect(backend.attempts.map((a) => a.cause)).toEqual(["initial", "handover"])
    expect(backend.attempts[1].modelId).not.toBe(backend.attempts[0].modelId)
    expect(events.some((e) => e.type === "subtask.fallback" && e.cause === "handover")).toBe(true)
  })

  it("fails the run and blocks dependents when every model is exhausted", async () => {
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra"], "sequential")
    const bus = new EventBus()
    const exec = new Executor(run, () => new ScriptedWorker({ backend: ["fail"] }), bus, { maxRetriesPerModel: 0, models: TEST_MODELS })
    expect(await exec.start()).toBe("failed")
    expect(exec.snapshot.find((s) => s.kind === "backend")!.state).toBe("failed")
    expect(exec.snapshot.find((s) => s.kind === "review")!.summary).toMatch(/upstream/)
  })

  it("resumes the same session after a timeout instead of restarting, then falls back", async () => {
    class TimeoutWorker implements Worker {
      readonly id = "t"
      calls: WorkerJob[] = []
      supports() {
        return true
      }
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        this.calls.push(job)
        sink.session(`sess-${job.modelId}`)
        const timedOut = job.modelId === "codex:gpt-6-astra" && this.calls.filter((c) => c.modelId === job.modelId).length <= 3
        return { done: Promise.resolve(timedOut ? { ok: false, summary: "timeout", error: "process exceeded limit", retryable: false, timedOut: true } : { ok: true, summary: "done" }), cancel: () => {} }
      }
    }
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra", "claude:sonnet"], "sequential")
    run.plan = run.plan.filter((s) => s.kind === "backend").map((s) => ({ ...s, dependsOn: [] }))
    run.routing = run.routing.filter((r) => r.kind === "backend").map((r) => ({ ...r, primaryModelId: "codex:gpt-6-astra", fallbackModelIds: ["claude:sonnet"] }))
    const worker = new TimeoutWorker()
    const bus = new EventBus()
    const exec = new Executor(run, () => worker, bus, { models: TEST_MODELS, maxContinuations: 2 })
    expect(await exec.start()).toBe("completed")
    const backend = exec.snapshot[0]
    expect(backend.attempts.map((a) => a.cause)).toEqual(["initial", "continue", "continue", "fallback"])
    expect(worker.calls[1].resumeSessionId).toBe("sess-codex:gpt-6-astra")
    expect(worker.calls[1].brief).toMatch(/Continue exactly where you left off/)
    expect(worker.calls[0].effort).toBe("medium")
    expect(worker.calls[0].timeoutSecs).toBe(40 * 60)
  })

  it("cancel stops everything", async () => {
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra"], "sequential")
    const bus = new EventBus()
    const exec = new Executor(run, () => new ScriptedWorker({}, true), bus, { models: TEST_MODELS })
    const p = exec.start()
    exec.cancel()
    expect(await p).toBe("cancelled")
    expect(exec.snapshot.every((s) => s.state === "failed")).toBe(true)
  })

  it("polish round: reviewer score below 9 spawns up to 3 fix tasks, score lands in the report", async () => {
    class PolishWorker implements Worker {
      readonly id = "p"
      jobs: WorkerJob[] = []
      supports() {
        return true
      }
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        this.jobs.push(job)
        sink.state("coding", 50)
        const summary = job.subtask.title === "Polish review"
          ? "Strong loop, weak feedback.\nSILENT_SCORE: 6\nSILENT_FIXES:\n- Add hit-stop and screen shake on every hit\n- Fix the pause menu focus trap\n- Add tests for the save migration\n- A fourth one that must be ignored\nSILENT_DEVIATIONS: none"
          : `done ${job.subtask.kind}`
        return { done: Promise.resolve({ ok: true, summary }), cancel: async () => {} }
      }
    }
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra", "claude:opus"], "sequential")
    run.plan = run.plan.filter((s) => s.kind === "backend").map((s) => ({ ...s, dependsOn: [] }))
    run.routing = run.routing.filter((r) => run.plan.some((s) => s.id === r.subtaskId))
    const bus = new EventBus()
    const events = collect(bus)
    const worker = new PolishWorker()
    const exec = new Executor(run, () => worker, bus, { models: TEST_MODELS, polish: true, polishModelId: "claude:opus", spec: "SPEC TEXT", kitBrief: "KIT TEXT" })
    expect(await exec.start()).toBe("completed")
    const titles = exec.snapshot.map((s) => s.title)
    expect(titles).toContain("Polish review")
    expect(titles.filter((t) => t.startsWith("Fix:"))).toHaveLength(3)
    expect(exec.snapshot.every((s) => s.state === "completed")).toBe(true)
    const kinds = exec.snapshot.filter((s) => s.title.startsWith("Fix:")).map((s) => s.kind)
    expect(kinds).toEqual(["frontend", "frontend", "tests"])
    expect(events.filter((e) => e.type === "subtask.added")).toHaveLength(4)
    const report = events.find((e) => e.type === "run.report")
    expect(report && report.type === "run.report" ? report.report.polishScore : undefined).toBe(6)
    // every worker brief carries the spec and the kit brief; fix tasks run on the polish model
    expect(worker.jobs.every((j) => j.brief.includes("SPEC TEXT") && j.brief.includes("KIT TEXT"))).toBe(true)
    expect(worker.jobs.filter((j) => j.subtask.title.startsWith("Fix:")).every((j) => j.modelId === "claude:opus")).toBe(true)
  })

  it("every worker brief carries the run plan with sibling ownership and the verification-scope rule", async () => {
    class BriefWorker implements Worker {
      readonly id = "b"
      briefs: string[] = []
      supports() {
        return true
      }
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        this.briefs.push(job.brief)
        sink.state("coding", 50)
        return { done: Promise.resolve({ ok: true, summary: "ok" }), cancel: async () => {} }
      }
    }
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra"], "sequential")
    run.plan = run.plan.map((s, i) => ({ ...s, dependsOn: [], description: `Owns: src/mod${i}/**. ${s.description}` }))
    const worker = new BriefWorker()
    const exec = new Executor(run, () => worker, new EventBus(), { models: TEST_MODELS })
    expect(await exec.start()).toBe("completed")
    expect(worker.briefs.length).toBe(run.plan.length)
    for (const b of worker.briefs) {
      expect(b).toMatch(/Run plan \(\d+ tasks/)
      expect(b).toMatch(/owns src\/mod\d+\/\*\*/)
      expect(b).toMatch(/Verification scope:/)
      expect(b).toMatch(/Module shadowing:/)
      expect(b).toMatch(/Converter toolkit:/)
    }
  })

  it("cancel mid-run stops scheduling, marks running attempts cancelled and reports run.cancelled", async () => {
    const run = makeRun("Add a real-time notification system with tests", TEST_POOL, "sequential")
    const bus = new EventBus()
    const events = collect(bus)
    const worker = new ScriptedWorker({}, true)
    const exec = new Executor(run, () => worker, bus, { models: TEST_MODELS })
    const done = exec.start()
    await new Promise((r) => setTimeout(r, 30))
    exec.cancel()
    expect(await done).toBe("cancelled")
    expect(events.some((e) => e.type === "run.cancelled")).toBe(true)
    expect(exec.snapshot.filter((s) => s.state === "completed")).toHaveLength(0)
    expect(exec.snapshot.every((s) => s.attempts.every((a) => a.outcome !== "running"))).toBe(true)
  })

  it("a failed polish review still completes the run (review is best-effort) and records no score", async () => {
    class ReviewFailsWorker implements Worker {
      readonly id = "rf"
      supports() {
        return true
      }
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        sink.state("coding", 50)
        const fail = job.subtask.title === "Polish review"
        return { done: Promise.resolve(fail ? { ok: false, summary: "crashed", error: "boom", retryable: false } : { ok: true, summary: "done" }), cancel: async () => {} }
      }
    }
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra", "claude:opus"], "sequential")
    run.plan = run.plan.filter((s) => s.kind === "backend").map((s) => ({ ...s, dependsOn: [] }))
    run.routing = run.routing.filter((r) => run.plan.some((s) => s.id === r.subtaskId))
    const bus = new EventBus()
    const events = collect(bus)
    const exec = new Executor(run, () => new ReviewFailsWorker(), bus, { models: TEST_MODELS, polish: true, polishModelId: "claude:opus", maxRetriesPerModel: 0 })
    const outcome = await exec.start()
    const report = events.find((e) => e.type === "run.report")
    expect(report && report.type === "run.report" ? report.report.polishScore : 1).toBeUndefined()
    expect(exec.snapshot.filter((s) => s.title.startsWith("Fix:"))).toHaveLength(0)
    expect(outcome).toBe("completed")
  })

  it("polish round falls back to [P1]/[P2] review comments when SILENT_FIXES is missing", async () => {
    class CommentWorker implements Worker {
      readonly id = "c"
      supports() {
        return true
      }
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        sink.state("coding", 50)
        const summary = job.subtask.title === "Polish review"
          ? "Solid base.\nSILENT_SCORE: 6\nFull review comments:\n- [P2] Extend Odin's lightning hitboxes to the arena floor — /repo/src/x.ts:272-273\nDetails here.\n- [P1] Honor the unblockable flag — /repo/src/y.ts:22\n- [P3] Minor naming\nSILENT_DEVIATIONS: none"
          : "done"
        return { done: Promise.resolve({ ok: true, summary }), cancel: async () => {} }
      }
    }
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra", "claude:opus"], "sequential")
    run.plan = run.plan.filter((s) => s.kind === "backend").map((s) => ({ ...s, dependsOn: [] }))
    run.routing = run.routing.filter((r) => run.plan.some((s) => s.id === r.subtaskId))
    const exec = new Executor(run, () => new CommentWorker(), new EventBus(), { models: TEST_MODELS, polish: true, polishModelId: "claude:opus" })
    expect(await exec.start()).toBe("completed")
    const fixes = exec.snapshot.filter((s) => s.title.startsWith("Fix:")).map((s) => s.title)
    expect(fixes).toHaveLength(3)
    expect(fixes[0]).toMatch(/^Fix: Honor the unblockable flag/)
    expect(fixes[1]).toMatch(/^Fix: Extend Odin's lightning hitboxes/)
  })
})

describe("targeted verification and diff polish (Faz 1)", () => {
  class BriefWorker implements Worker {
    readonly id = "b"
    briefs = new Map<string, string>()
    supports() {
      return true
    }
    start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
      this.briefs.set(job.subtask.title, job.brief)
      sink.state("coding", 50)
      sink.file(`src/${job.subtask.kind}/a.ts`)
      const summary = job.subtask.title === "Polish review" ? "Fine.\nSILENT_SCORE: 9\nSILENT_FIXES: none\nSILENT_DEVIATIONS: none" : "ok"
      return { done: Promise.resolve({ ok: true, summary }), cancel: async () => {} }
    }
  }
  it("tells every worker its verify command; falls back to the owned paths when the planner gave none", async () => {
    const run = makeRun("Build the backend API and the frontend dashboard", ["codex:gpt-6-astra"], "sequential")
    run.plan = run.plan.map((s, i) => ({ ...s, dependsOn: [], description: `Owns: src/mod${i}/**, tests/mod${i}/**. ${s.description}`, verify: i === 0 ? "npx vitest run tests/mod0 && npx tsc --noEmit" : undefined }))
    const worker = new BriefWorker()
    const exec = new Executor(run, () => worker, new EventBus(), { models: TEST_MODELS })
    expect(await exec.start()).toBe("completed")
    const first = worker.briefs.get(run.plan[0].title)!
    expect(first).toMatch(/Verify with: `npx vitest run tests\/mod0 && npx tsc --noEmit`/)
    const second = worker.briefs.get(run.plan[1].title)!
    expect(second).toMatch(/Verify with: `npx vitest run src\/mod1 tests\/mod1/)
    expect(second).toMatch(/full suite only if this is the integration task/)
  })
  it("the polish reviewer gets the changed files and the screenshot folder instead of a full play-through", async () => {
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra", "claude:opus"], "sequential")
    run.plan = run.plan.filter((s) => s.kind === "backend").map((s) => ({ ...s, dependsOn: [] }))
    run.routing = run.routing.filter((r) => run.plan.some((s) => s.id === r.subtaskId))
    const worker = new BriefWorker()
    const exec = new Executor(run, () => worker, new EventBus(), { models: TEST_MODELS, polish: true, polishModelId: "claude:opus" })
    exec.setChangedFiles(["src/backend/a.ts", "src/backend/b.ts"])
    expect(await exec.start()).toBe("completed")
    const polish = worker.briefs.get("Polish review")!
    expect(polish).toMatch(/Changed files \(2\)/)
    expect(polish).toMatch(/src\/backend\/b\.ts/)
    expect(polish).toMatch(/\.silent\/tmp\/shots/)
    expect(polish).toMatch(/run the checks once/i)
    expect(polish).not.toMatch(/play\/click through the main flows/)
  })
})

describe("repo digest in worker briefs (Faz 2)", () => {
  it("carries a 12 KB project context (digest + architecture brief) without truncating it to 8 KB", async () => {
    class BriefWorker implements Worker {
      readonly id = "b"
      briefs: string[] = []
      supports() {
        return true
      }
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        this.briefs.push(job.brief)
        sink.state("coding", 50)
        return { done: Promise.resolve({ ok: true, summary: "ok" }), cancel: async () => {} }
      }
    }
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra"], "sequential")
    run.plan = run.plan.slice(0, 1).map((s) => ({ ...s, dependsOn: [] }))
    const worker = new BriefWorker()
    const context = `# Repo digest\n${"- src/x.ts: a, b\n".repeat(700)}`
    const exec = new Executor(run, () => worker, new EventBus(), { models: TEST_MODELS, context })
    expect(context.length).toBeGreaterThan(9000)
    expect(await exec.start()).toBe("completed")
    expect(worker.briefs[0]).toContain(context.slice(0, 11000))
  })
})

describe("prompt-cache alignment and short reports (Faz 3)", () => {
  class BriefWorker implements Worker {
    readonly id = "b"
    briefs: string[] = []
    supports() {
      return true
    }
    start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
      this.briefs.push(job.brief)
      sink.state("coding", 50)
      return { done: Promise.resolve({ ok: true, summary: "ok" }), cancel: async () => {} }
    }
  }
  it("every brief starts with the same run-wide prefix (spec, kit, context, rules) and the task-specific part comes last", async () => {
    const run = makeRun("Build the backend API and the frontend dashboard", ["codex:gpt-6-astra"], "sequential")
    run.plan = run.plan.map((s) => ({ ...s, dependsOn: [] }))
    const worker = new BriefWorker()
    const exec = new Executor(run, () => worker, new EventBus(), { models: TEST_MODELS, spec: "SPEC TEXT", kitBrief: "KIT TEXT", context: "CONTEXT TEXT" })
    expect(await exec.start()).toBe("completed")
    expect(worker.briefs.length).toBeGreaterThan(1)
    const marker = "\n\n# TASK\n\n"
    const prefixes = worker.briefs.map((b) => b.split(marker)[0])
    expect(prefixes.every((p) => p === prefixes[0])).toBe(true)
    const p = prefixes[0]
    // fixed prefix carries everything run-wide, in a stable order
    for (const [a, b] of [["SPEC TEXT", "KIT TEXT"], ["KIT TEXT", "CONTEXT TEXT"], ["CONTEXT TEXT", "Rules: (1)"]]) expect(p.indexOf(a)).toBeLessThan(p.indexOf(b))
    expect(p.indexOf("SPEC TEXT")).toBeGreaterThanOrEqual(0)
    // nothing task-specific leaks into the prefix
    expect(p).not.toMatch(/Task: /)
    expect(p).not.toMatch(/Verify with:/)
    expect(p).not.toMatch(/working as the \w+ worker/)
    const task = worker.briefs[0].split(marker)[1]
    expect(task).toMatch(/You are .* working as the \w+ worker/)
    expect(task).toMatch(/Task: /)
    expect(task).toMatch(/Verify with:/)
  })
  it("asks for a short summary (at most 15 lines) instead of an essay", async () => {
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra"], "sequential")
    run.plan = run.plan.slice(0, 1).map((s) => ({ ...s, dependsOn: [] }))
    const worker = new BriefWorker()
    const exec = new Executor(run, () => worker, new EventBus(), { models: TEST_MODELS })
    expect(await exec.start()).toBe("completed")
    expect(worker.briefs[0]).toMatch(/summary .*at most 15 lines/i)
  })
})

describe("load guard in the executor (Faz 3)", () => {
  it("a live concurrency cap of 1 serializes a parallel run", async () => {
    let inFlight = 0
    let peak = 0
    class SlowWorker implements Worker {
      readonly id = "s"
      supports() {
        return true
      }
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        sink.state("coding", 50)
        const done = new Promise<{ ok: true; summary: string }>((r) => setTimeout(() => {
          inFlight -= 1
          r({ ok: true, summary: `done ${job.subtask.title}` })
        }, 5))
        return { done, cancel: async () => {} }
      }
    }
    const run = makeRun("Build the backend API and the frontend dashboard", ["codex:gpt-6-astra"], "parallel")
    run.plan = run.plan.map((s) => ({ ...s, dependsOn: [] }))
    expect(run.plan.length).toBeGreaterThan(1)
    const exec = new Executor(run, () => new SlowWorker(), new EventBus(), { models: TEST_MODELS, concurrency: () => 1 })
    expect(await exec.start()).toBe("completed")
    expect(peak).toBe(1)
  })
})

describe("warm sessions (Faz 3)", () => {
  class SessionWorker implements Worker {
    readonly id = "w"
    jobs: WorkerJob[] = []
    private n = 0
    supports() {
      return true
    }
    start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
      this.jobs.push(job)
      this.n += 1
      const sessionId = job.resumeSessionId ?? `sess-${this.n}`
      sink.session(sessionId)
      sink.usage(1000, 0)
      sink.state("coding", 50)
      return { done: Promise.resolve({ ok: true, summary: `done ${job.subtask.title}` }), cancel: async () => {} }
    }
  }
  it("a task on the same model resumes the previous task's finished session and says it is a new task", async () => {
    const run = makeRun("Build the backend API and the frontend dashboard", ["codex:gpt-6-astra"], "sequential")
    run.plan = run.plan.map((s) => ({ ...s, dependsOn: [] }))
    expect(run.plan.length).toBeGreaterThan(1)
    const worker = new SessionWorker()
    const exec = new Executor(run, () => worker, new EventBus(), { models: TEST_MODELS, warmSessions: true })
    expect(await exec.start()).toBe("completed")
    expect(worker.jobs[0].resumeSessionId).toBeUndefined()
    expect(worker.jobs[1].resumeSessionId).toBe("sess-1")
    expect(worker.jobs[1].brief).toMatch(/^NEW TASK/)
    expect(worker.jobs[1].brief).toMatch(/Task: /)
  })
  it("is off when the option is false, and a session that already carries too many tokens is not reused", async () => {
    const run = makeRun("Build the backend API and the frontend dashboard", ["codex:gpt-6-astra"], "sequential")
    run.plan = run.plan.map((s) => ({ ...s, dependsOn: [] }))
    const off = new SessionWorker()
    expect(await new Executor(run, () => off, new EventBus(), { models: TEST_MODELS }).start()).toBe("completed")
    expect(off.jobs.every((j) => !j.resumeSessionId)).toBe(true)
    class HeavyWorker extends SessionWorker {
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        const h = super.start(job, sink)
        sink.usage(200_000, 0)
        return h
      }
    }
    const heavy = new HeavyWorker()
    const run2 = makeRun("Build the backend API and the frontend dashboard", ["codex:gpt-6-astra"], "sequential")
    run2.plan = run2.plan.map((s) => ({ ...s, dependsOn: [] }))
    expect(await new Executor(run2, () => heavy, new EventBus(), { models: TEST_MODELS, warmSessions: true }).start()).toBe("completed")
    expect(heavy.jobs.every((j) => !j.resumeSessionId)).toBe(true)
  })
})

describe("task split (Faz 3)", () => {
  it("a worker's SILENT_SPLIT becomes sibling tasks on the same model; dependents wait for all of them", async () => {
    const run = makeRun("Build the backend API and the frontend dashboard", ["codex:gpt-6-astra"], "parallel")
    // backend first, frontend depends on it
    const backend = run.plan.find((s) => s.kind === "backend")!
    run.plan = run.plan.filter((s) => s.kind === "backend" || s.kind === "frontend").map((s) => ({ ...s, dependsOn: s.kind === "frontend" ? [backend.id] : [] }))
    run.routing = run.routing.filter((r) => run.plan.some((s) => s.id === r.subtaskId))
    const started: string[] = []
    class SplitWorker implements Worker {
      readonly id = "sp"
      supports() {
        return true
      }
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        started.push(job.subtask.title)
        sink.state("coding", 50)
        const first = job.subtask.id === backend.id
        return { done: Promise.resolve(first ? { ok: true, summary: "did the schema", split: ["Users endpoint. Owns: src/api/users/**", "Orders endpoint. Owns: src/api/orders/**"] } : { ok: true, summary: `ok ${job.subtask.title}` }), cancel: async () => {} }
      }
    }
    const exec = new Executor(run, () => new SplitWorker(), new EventBus(), { models: TEST_MODELS })
    expect(await exec.start()).toBe("completed")
    const all = exec.snapshot
    expect(all).toHaveLength(4)
    const children = all.filter((s) => s.title.startsWith("Users endpoint") || s.title.startsWith("Orders endpoint"))
    expect(children).toHaveLength(2)
    expect(children.every((s) => s.kind === "backend" && s.state === "completed")).toBe(true)
    const frontend = all.find((s) => s.kind === "frontend")!
    expect(children.every((c) => frontend.dependsOn.includes(c.id))).toBe(true)
    // the frontend started only after both children finished
    expect(started.indexOf(frontend.title)).toBeGreaterThan(Math.max(...children.map((c) => started.indexOf(c.title))))
    expect(all.find((s) => s.id === backend.id)?.summary).toMatch(/did the schema/)
  })
  it("the timeout continuation brief invites the worker to split what remains", async () => {
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra"], "sequential")
    run.plan = run.plan.slice(0, 1).map((s) => ({ ...s, dependsOn: [] }))
    const briefs: string[] = []
    let n = 0
    class TimeoutOnce implements Worker {
      readonly id = "to"
      supports() {
        return true
      }
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        briefs.push(job.brief)
        sink.session("sess-1")
        n += 1
        return { done: Promise.resolve(n === 1 ? { ok: false, summary: "timeout", error: "timeout", retryable: true, timedOut: true } : { ok: true, summary: "ok" }), cancel: async () => {} }
      }
    }
    const exec = new Executor(run, () => new TimeoutOnce(), new EventBus(), { models: TEST_MODELS, maxContinuations: 2 })
    expect(await exec.start()).toBe("completed")
    expect(briefs[1]).toMatch(/SILENT_SPLIT:/)
    expect(briefs[1]).toMatch(/20 min/)
  })
  it("requestSplit stops the running attempt and resumes its session with a split request", async () => {
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra"], "sequential")
    run.plan = run.plan.slice(0, 1).map((s) => ({ ...s, dependsOn: [] }))
    const briefs: string[] = []
    const jobs: WorkerJob[] = []
    let n = 0
    class CancellableWorker implements Worker {
      readonly id = "cw"
      supports() {
        return true
      }
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        briefs.push(job.brief)
        jobs.push(job)
        sink.session("sess-9")
        n += 1
        if (n === 1) {
          let resolve!: (r: { ok: false; summary: string; error: string; retryable: false }) => void
          const done = new Promise<{ ok: false; summary: string; error: string; retryable: false }>((r) => (resolve = r))
          return { done, cancel: async () => resolve({ ok: false, summary: "cancelled", error: "cancelled", retryable: false }) }
        }
        return { done: Promise.resolve(n === 2 ? { ok: true, summary: "did half", split: ["Rest A. Owns: a/**", "Rest B. Owns: b/**"] } : { ok: true, summary: `ok ${job.subtask.title}` }), cancel: async () => {} }
      }
    }
    const exec = new Executor(run, () => new CancellableWorker(), new EventBus(), { models: TEST_MODELS })
    const finished = exec.start()
    await new Promise((r) => setTimeout(r, 5))
    expect(exec.requestSplit(run.plan[0].id)).toBe(true)
    expect(await finished).toBe("completed")
    expect(jobs[1].resumeSessionId).toBe("sess-9")
    expect(briefs[1]).toMatch(/SILENT_SPLIT:/)
    expect(exec.snapshot).toHaveLength(3)
  })
})


describe("task handover (quota/limit → another model continues)", () => {
  class RejectThenBrief implements Worker {
    readonly id = "rb"
    jobs: WorkerJob[] = []
    private n = 0
    supports() {
      return true
    }
    start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
      this.jobs.push(job)
      this.n += 1
      sink.state("coding", 40)
      sink.command("npm test -- player")
      sink.file("src/game/player.ts")
      const first = this.n === 1
      return {
        done: Promise.resolve(first ? { ok: false, summary: "failed", error: "You have hit your usage limit for this model (429)", retryable: false, lastMessage: "I implemented the player module and was about to wire input." } : { ok: true, summary: "finished" }),
        cancel: async () => {},
      }
    }
  }
  it("a same-tier model takes over with a HANDOVER brief that carries files, commands and the previous worker's last message", async () => {
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra", "claude:opus"], "sequential")
    run.plan = run.plan.filter((s) => s.kind === "backend").map((s) => ({ ...s, dependsOn: [] }))
    run.routing = run.routing.filter((r) => run.plan.some((s) => s.id === r.subtaskId)).map((r) => ({ ...r, fallbackModelIds: [] }))
    const worker = new RejectThenBrief()
    const exec = new Executor(run, () => worker, new EventBus(), { models: TEST_MODELS })
    expect(await exec.start()).toBe("completed")
    const st = exec.snapshot[0]
    expect(st.attempts.map((a) => a.cause)).toEqual(["initial", "handover"])
    expect(st.attempts[1].modelId).not.toBe(st.attempts[0].modelId)
    const brief = worker.jobs[1].brief
    expect(brief).toMatch(/# HANDOVER/)
    expect(brief).toContain("src/game/player.ts")
    expect(brief).toContain("npm test -- player")
    expect(brief).toContain("about to wire input")
    expect(brief).toMatch(/already contains/i)
    expect(worker.jobs[1].resumeSessionId).toBeUndefined()
  })
  it("a dead model is skipped by every later subtask of the run and is never retried", async () => {
    const run = makeRun("Build the backend API and the frontend dashboard", ["codex:gpt-6-astra", "claude:opus"], "sequential")
    run.plan = run.plan.filter((s) => s.kind === "backend" || s.kind === "frontend").map((s) => ({ ...s, dependsOn: [] }))
    run.routing = run.routing.filter((r) => run.plan.some((s) => s.id === r.subtaskId)).map((r) => ({ ...r, primaryModelId: "codex:gpt-6-astra", fallbackModelIds: [] }))
    const worker = new ScriptedWorker({ backend: ["reject", "ok"], frontend: ["ok"] })
    const exec = new Executor(run, () => worker, new EventBus(), { models: TEST_MODELS, maxRetriesPerModel: 2 })
    expect(await exec.start()).toBe("completed")
    const backend = exec.snapshot.find((s) => s.kind === "backend")!
    expect(backend.attempts).toHaveLength(2)
    expect(backend.attempts.map((a) => a.modelId)).toEqual(["codex:gpt-6-astra", "claude:opus"])
    const frontend = exec.snapshot.find((s) => s.kind === "frontend")!
    expect(frontend.attempts[0].modelId).toBe("claude:opus")
  })
  it("requestHandover stops the running attempt and continues on the chosen model without resuming a session", async () => {
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra", "claude:opus", "claude:sonnet"], "sequential")
    run.plan = run.plan.slice(0, 1).map((s) => ({ ...s, dependsOn: [] }))
    const jobs: WorkerJob[] = []
    let n = 0
    class HangOnce implements Worker {
      readonly id = "ho"
      supports() {
        return true
      }
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        jobs.push(job)
        n += 1
        sink.session(`sess-${n}`)
        if (n === 1) {
          let resolve!: (r: { ok: false; summary: string; error: string; retryable: false }) => void
          const done = new Promise<{ ok: false; summary: string; error: string; retryable: false }>((r) => (resolve = r))
          return { done, cancel: async () => resolve({ ok: false, summary: "cancelled", error: "cancelled", retryable: false }) }
        }
        return { done: Promise.resolve({ ok: true, summary: "ok" }), cancel: async () => {} }
      }
    }
    const exec = new Executor(run, () => new HangOnce(), new EventBus(), { models: TEST_MODELS })
    const finished = exec.start()
    await new Promise((r) => setTimeout(r, 5))
    expect(exec.requestHandover(run.plan[0].id, "claude:sonnet")).toBe(true)
    expect(await finished).toBe("completed")
    const st = exec.snapshot[0]
    expect(st.attempts.map((a) => a.cause)).toEqual(["initial", "handover"])
    expect(jobs[1].modelId).toBe("claude:sonnet")
    expect(jobs[1].resumeSessionId).toBeUndefined()
    expect(jobs[1].brief).toMatch(/# HANDOVER/)
  })
})

describe("cancel during a warm attempt (2026-10-05)", () => {
  it("does not start a fresh retry after the run was cancelled", async () => {
    const run = makeRun("Build the backend API and the frontend dashboard", ["codex:gpt-6-astra"], "sequential")
    run.plan = run.plan.map((s) => ({ ...s, dependsOn: [] }))
    const execRef: { current?: Executor } = {}
    class CancellingWorker implements Worker {
      readonly id = "c"
      jobs: WorkerJob[] = []
      supports() {
        return true
      }
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        this.jobs.push(job)
        sink.session(job.resumeSessionId ?? `sess-${this.jobs.length}`)
        if (job.resumeSessionId) {
          // the warm attempt: the user cancels while it runs; the CLI reports a plain (non-timeout) failure
          execRef.current!.cancel()
          return { done: Promise.resolve({ ok: false, summary: "cancelled", error: "cancelled", retryable: false }), cancel: async () => {} }
        }
        return { done: Promise.resolve({ ok: true, summary: "done" }), cancel: async () => {} }
      }
    }
    const worker = new CancellingWorker()
    execRef.current = new Executor(run, () => worker, new EventBus(), { models: TEST_MODELS, warmSessions: true })
    await execRef.current!.start()
    expect(worker.jobs.filter((j) => j.resumeSessionId).length).toBe(1)
    expect(worker.jobs.length).toBe(2)
  })
})

describe("failure reasons reach the store (2026-10-05 R6) and deadlocked plans never hang (R10)", () => {
  it("a non-retryable failure emits subtask.state failed with the error, and the run fails with a reason", async () => {
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra"], "sequential")
    run.plan = run.plan.map((s) => ({ ...s, dependsOn: [] }))
    class BoomWorker implements Worker {
      readonly id = "boom"
      supports() {
        return true
      }
      start(): WorkerHandle {
        return { done: Promise.resolve({ ok: false, summary: "failed", error: "boom", retryable: false }), cancel: () => undefined }
      }
    }
    const bus = new EventBus()
    const events: RunEvent[] = []
    bus.subscribe((e) => events.push(e))
    const exec = new Executor(run, () => new BoomWorker(), bus, { models: TEST_MODELS, maxRetriesPerModel: 1 })
    const result = await exec.start()
    expect(result).toBe("failed")
    const failed = events.find((e) => e.type === "subtask.state" && e.state === "failed") as Extract<RunEvent, { type: "subtask.state" }> | undefined
    expect(failed?.error).toBe("boom")
    const rf = events.find((e) => e.type === "run.failed") as Extract<RunEvent, { type: "run.failed" }> | undefined
    expect(rf?.reason).toMatch(/Failed: .+/)
  })
  it("a dependency cycle fails the involved subtasks with a readable reason instead of waiting forever", async () => {
    const run = makeRun("Build the backend API and the frontend dashboard", ["codex:gpt-6-astra"], "parallel")
    const [a, b] = run.plan
    run.plan = run.plan.map((s) => (s.id === a!.id ? { ...s, dependsOn: [b!.id] } : s.id === b!.id ? { ...s, dependsOn: [a!.id] } : { ...s, dependsOn: [] }))
    const bus = new EventBus()
    const events: RunEvent[] = []
    bus.subscribe((e) => events.push(e))
    const exec = new Executor(run, () => new ScriptedWorker(), bus, { models: TEST_MODELS })
    const result = await Promise.race([exec.start(), new Promise<"hang">((r) => setTimeout(() => r("hang"), 2000))])
    expect(result).toBe("failed")
    const cyc = events.filter((e) => e.type === "subtask.state" && e.state === "failed") as Array<Extract<RunEvent, { type: "subtask.state" }>>
    expect(cyc.some((e) => /dependency cycle/.test(e.error ?? ""))).toBe(true)
    const rf = events.find((e) => e.type === "run.failed") as Extract<RunEvent, { type: "run.failed" }> | undefined
    expect(rf?.reason).toContain("Failed:")
    expect(rf?.reason.length).toBeGreaterThan("Failed: ".length)
  })
})

describe("stall fixes (2026-10-05): dead sessions, foreground rule, auto-answer", () => {
  class Recorder implements Worker {
    readonly id = "rec"
    jobs: WorkerJob[] = []
    private readonly results: Array<(job: WorkerJob, sink: WorkerSink) => Promise<import("./workers/Worker").WorkerResult>>
    constructor(results: Array<(job: WorkerJob, sink: WorkerSink) => Promise<import("./workers/Worker").WorkerResult>>) {
      this.results = results
    }
    supports() {
      return true
    }
    start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
      this.jobs.push(job)
      sink.session(job.resumeSessionId ?? `sess-${this.jobs.length}`)
      const fn = this.results[Math.min(this.jobs.length - 1, this.results.length - 1)]!
      return { done: fn(job, sink), cancel: async () => {} }
    }
  }
  const oneTask = () => {
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra"], "sequential")
    run.plan = [run.plan[0]!].map((s) => ({ ...s, dependsOn: [] }))
    return run
  }
  it("F3: a dead session is retried fresh (no resume), never continued", async () => {
    const run = oneTask()
    const worker = new Recorder([
      async () => ({ ok: false, summary: "dead", error: "codex produced no output for 900 s (dead session)", retryable: true, timedOut: false, activity: { messages: 0, commands: 0, events: 0 } }),
      async () => ({ ok: true, summary: "done" }),
    ])
    const bus = new EventBus()
    const logs: string[] = []
    const reasons: string[] = []
    bus.subscribe((e: RunEvent) => {
      if (e.type === "worker.log") logs.push(e.line.text)
      if (e.type === "subtask.retry") reasons.push(e.reason)
    })
    const causes: string[] = []
    bus.subscribe((e: RunEvent) => {
      if (e.type === "subtask.assigned") causes.push(e.attempt.cause)
    })
    expect(await new Executor(run, () => worker, bus, { models: TEST_MODELS }).start()).toBe("completed")
    expect(causes).toEqual(["initial", "retry"])
    expect(worker.jobs[1]!.resumeSessionId).toBeUndefined()
    expect(logs.some((l) => /produced nothing/.test(l))).toBe(true)
    expect(reasons.some((r) => /continue/.test(r))).toBe(false)
  })
  it("F3: a continuation reason carries the activity summary", async () => {
    const run = oneTask()
    const worker = new Recorder([
      async () => ({ ok: false, summary: "timeout", error: "process exceeded limit", retryable: false, timedOut: true, activity: { messages: 12, commands: 7, events: 40 } }),
      async () => ({ ok: true, summary: "done" }),
    ])
    const bus = new EventBus()
    const reasons: string[] = []
    bus.subscribe((e: RunEvent) => {
      if (e.type === "subtask.retry") reasons.push(e.reason)
    })
    expect(await new Executor(run, () => worker, bus, { models: TEST_MODELS }).start()).toBe("completed")
    expect(reasons[0]).toMatch(/timeout → continue session \(12 msgs, 7 cmds\)/)
    expect(worker.jobs[1]!.resumeSessionId).toBe("sess-1")
  })
  it("F4: the worker brief forbids background jobs and sleep polling", async () => {
    const run = oneTask()
    const worker = new Recorder([async () => ({ ok: true, summary: "done" })])
    await new Executor(run, () => worker, new EventBus(), { models: TEST_MODELS }).start()
    const brief = worker.jobs[0]!.brief
    expect(brief).toMatch(/foreground/i)
    expect(brief).toMatch(/sleep/)
    expect(brief).toMatch(/timeout 1200/)
  })
  it("F5: a blocked worker is auto-answered after autoAnswerMs with the standard answer", async () => {
    const { AUTO_ANSWER } = await import("./executor")
    const run = oneTask()
    const worker = new Recorder([
      async () => ({ ok: false, blocked: true, question: "Which colour?", summary: "q", retryable: false }),
      async () => ({ ok: true, summary: "done" }),
    ])
    const bus = new EventBus()
    const events: RunEvent[] = []
    bus.subscribe((e: RunEvent) => events.push(e))
    expect(await new Executor(run, () => worker, bus, { models: TEST_MODELS, autoAnswerMs: 50 }).start()).toBe("completed")
    expect(worker.jobs[1]!.brief).toContain(AUTO_ANSWER)
    expect(events.filter((e) => e.type === "subtask.assigned").map((e) => (e.type === "subtask.assigned" ? e.attempt.cause : ""))).toEqual(["initial", "answer"])
    const answered = events.find((e) => e.type === "subtask.answered")
    expect(answered && "auto" in answered && answered.auto).toBe(true)
    expect(events.some((e) => e.type === "worker.log" && /auto-answered/.test(e.line.text))).toBe(true)
  })
  it("F5: with autoAnswerMs 0 the worker stays blocked; a real answer before the timer wins and the timer is cleared", async () => {
    const { AUTO_ANSWER } = await import("./executor")
    const run = oneTask()
    const worker = new Recorder([
      async () => ({ ok: false, blocked: true, question: "Which colour?", summary: "q", retryable: false }),
      async () => ({ ok: true, summary: "done" }),
    ])
    const exec = new Executor(run, () => worker, new EventBus(), { models: TEST_MODELS, autoAnswerMs: 0 })
    const started = exec.start()
    await new Promise((r) => setTimeout(r, 120))
    expect(exec.pendingQuestions().length).toBe(1)
    expect(worker.jobs).toHaveLength(1)
    exec.cancel()
    await started
    // real answer first
    const run2 = oneTask()
    const worker2 = new Recorder([
      async () => ({ ok: false, blocked: true, question: "Which colour?", summary: "q", retryable: false }),
      async () => ({ ok: true, summary: "done" }),
    ])
    const exec2 = new Executor(run2, () => worker2, new EventBus(), { models: TEST_MODELS, autoAnswerMs: 80 })
    const p = exec2.start()
    await new Promise((r) => setTimeout(r, 20))
    exec2.answer(run2.plan[0]!.id, "blue")
    expect(await p).toBe("completed")
    await new Promise((r) => setTimeout(r, 120))
    expect(worker2.jobs).toHaveLength(2)
    expect(worker2.jobs[1]!.brief).toContain("blue")
    expect(worker2.jobs[1]!.brief).not.toContain(AUTO_ANSWER)
  })
})

describe("host-capped slots are reported (2026-10-05 time-waste hunt)", () => {
  const threeIndependent = () => {
    const run = makeRun("Build the backend API and the frontend dashboard", TEST_POOL, "parallel")
    run.plan = run.plan.slice(0, 1)
    const base = run.plan[0]!
    run.plan = [0, 1, 2].map((i) => ({ ...base, id: `t${i}`, title: `Task ${i}`, dependsOn: [] }))
    run.routing = routeSubtasks({ subtasks: run.plan, pool: TEST_POOL, models: TEST_MODELS, costMode: "balanced" })
    return run
  }
  it("cap 1 with three independent tasks: one note per (waiting, cap) change, then cleared", async () => {
    const run = threeIndependent()
    const bus = new EventBus()
    const events = collect(bus)
    const exec = new Executor(run, () => new ScriptedWorker(), bus, { models: TEST_MODELS, concurrency: () => 1 })
    await exec.start()
    const capped = events.filter((e): e is Extract<RunEvent, { type: "run.capped" }> => e.type === "run.capped")
    expect(capped.map((e) => [e.ready, e.cap])).toEqual([[2, 1], [1, 1], [0, 1]])
    const notes = events.filter((e) => e.type === "worker.log" && e.line.text.includes("wait for a slot"))
    expect(notes.map((e) => (e.type === "worker.log" ? e.line.text : ""))).toEqual(["⏸ 2 ready task(s) wait for a slot — host busy (cap 1)", "⏸ 1 ready task(s) wait for a slot — host busy (cap 1)"])
  })
  it("no host cap: no capped events", async () => {
    const run = threeIndependent()
    const bus = new EventBus()
    const events = collect(bus)
    const exec = new Executor(run, () => new ScriptedWorker(), bus, { models: TEST_MODELS, concurrency: () => Infinity })
    await exec.start()
    expect(events.some((e) => e.type === "run.capped")).toBe(false)
  })
  it("the runs reducer stores and clears waitingSlots", async () => {
    const { applyEvent } = await import("@/stores/runs")
    const run = threeIndependent()
    const a = applyEvent(run, { type: "run.capped", runId: run.id, ready: 2, cap: 1, at: 1 })
    expect(a.waitingSlots).toEqual({ ready: 2, cap: 1 })
    expect(applyEvent(a, { type: "run.capped", runId: run.id, ready: 0, cap: 1, at: 2 }).waitingSlots).toBeUndefined()
  })
})

describe("quota exhaustion on the only browser-capable model (2026-10-05)", () => {
  const MODELS = [
    { id: "gemini-3.8-flash-high", providerId: "antigravity" as const, displayName: "Gemini 3.8 Flash", source: "catalog" as const, tier: "fast" as const },
    { id: "gpt-5.6-terra", providerId: "codex" as const, displayName: "Terra", source: "catalog" as const, tier: "strong" as const },
    { id: "sonnet", providerId: "claude" as const, displayName: "Claude Sonnet", source: "alias" as const, tier: "strong" as const },
  ]
  const POOL = ["antigravity:gemini-3.8-flash-high", "codex:gpt-5.6-terra"]
  const browserRun = (n: number): SilentCodeRun => {
    const plan = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, runId: "run_q", kind: "testing" as SubtaskKind, title: `Browser check ${i}`, description: "play it", dependsOn: [], state: "waiting" as const, attempts: [], files: [], commands: [], weight: 1 as const, progress: 0, lastUpdate: 0, answers: [], deviations: [], needsBrowser: true }))
    const routing = plan.map((p) => ({ subtaskId: p.id, kind: p.kind, primaryModelId: POOL[0]!, fallbackModelIds: [], reason: "browser", score: 1 }))
    return { id: "run_q", title: "q", prompt: "q", modelPool: POOL, executionMode: "parallel", costMode: "balanced", plan, routing, status: "planned", estimate: { minutes: 1, tokens: 1, costUsd: 0 } as never, createdAt: 0 } as SilentCodeRun
  }
  class QuotaWorker implements Worker {
    readonly id = "q"
    jobs: WorkerJob[] = []
    running = 0
    maxRunningAgy = 0
    quotaLeft: number
    constructor(quotaLeft: number) {
      this.quotaLeft = quotaLeft
    }
    supports() {
      return true
    }
    start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
      this.jobs.push(job)
      sink.session(`s-${this.jobs.length}`)
      const agy = job.modelId.startsWith("antigravity:")
      if (agy) this.running += 1
      this.maxRunningAgy = Math.max(this.maxRunningAgy, this.running)
      const done = new Promise<import("./workers/Worker").WorkerResult>((resolve) => setTimeout(() => {
        if (agy) this.running -= 1
        if (agy && this.quotaLeft <= 0) return resolve({ ok: false, summary: "quota", error: "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 0h0m1s.", retryable: false })
        if (agy) this.quotaLeft -= 1
        resolve({ ok: true, summary: "checked" })
      }, 20))
      return { done, cancel: async () => {} }
    }
  }
  it("waits for the announced reset and finishes on the same model instead of failing the run", async () => {
    const worker = new QuotaWorker(0)
    const bus = new EventBus()
    const events = collect(bus)
    const exec = new Executor(browserRun(1), () => worker, bus, { models: MODELS })
    worker.quotaLeft = 0
    setTimeout(() => (worker.quotaLeft = 5), 300) // the quota "resets"
    const status = await exec.start()
    expect(status).toBe("completed")
    const deferred = events.filter((e) => e.type === "subtask.deferred")
    expect(deferred.length).toBe(2) // waiting, then resumed
    expect(worker.jobs.every((j) => j.modelId.startsWith("antigravity:"))).toBe(true)
  }, 10_000)
  it("with the outside-pool browser fallback on, a browser task moves to a catalog model (Claude) at once", async () => {
    const worker = new QuotaWorker(0)
    const exec = new Executor(browserRun(1), () => worker, new EventBus(), { models: MODELS, browserFallbackOutsidePool: true })
    const status = await exec.start()
    expect(status).toBe("completed")
    expect(worker.jobs.map((j) => j.modelId)).toEqual(["antigravity:gemini-3.8-flash-high", "claude:sonnet"])
  })
  it("never runs two browser sessions on the same provider at once", async () => {
    const worker = new QuotaWorker(10)
    const exec = new Executor(browserRun(3), () => worker, new EventBus(), { models: MODELS })
    expect(await exec.start()).toBe("completed")
    expect(worker.maxRunningAgy).toBe(1)
  })
  describe("waits for whichever eligible model resets first (2026-10-05: Kimi had no reset time, Gemini did)", () => {
    const KIMI = "kimi:kimi-code/kimi-for-coding"
    const M2 = [...MODELS, { id: "kimi-code/kimi-for-coding", providerId: "kimi" as const, displayName: "Kimi", source: "catalog" as const, tier: "strong" as const }]
    const P2 = [...POOL, KIMI]
    class KimiOut extends QuotaWorker {
      start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
        if (!job.modelId.startsWith("kimi:")) return super.start(job, sink)
        this.jobs.push(job)
        sink.session(`s-${this.jobs.length}`)
        const done = new Promise<import("./workers/Worker").WorkerResult>((resolve) => setTimeout(() => resolve({ ok: false, summary: "quota", error: "provider.auth_error: 403 You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends.", retryable: false }), 10))
        return { done, cancel: async () => {} }
      }
    }
    const mk = (tasks: { id: string; browser: boolean; primary: string; fallbacks: string[]; dependsOn?: string[] }[]): SilentCodeRun => {
      const plan = tasks.map((t) => ({ id: t.id, runId: "run_k", kind: "testing" as SubtaskKind, title: t.id, description: "x", dependsOn: t.dependsOn ?? [], state: "waiting" as const, attempts: [], files: [], commands: [], weight: 1 as const, progress: 0, lastUpdate: 0, answers: [], deviations: [], needsBrowser: t.browser }))
      const routing = tasks.map((t) => ({ subtaskId: t.id, kind: "testing" as SubtaskKind, primaryModelId: t.primary, fallbackModelIds: t.fallbacks, reason: "x", score: 1 }))
      return { id: "run_k", title: "k", prompt: "k", modelPool: P2, executionMode: "parallel", costMode: "balanced", plan, routing, status: "planned", estimate: { minutes: 1, tokens: 1, costUsd: 0 } as never, createdAt: 0 } as SilentCodeRun
    }
    it("after a rejection: the failing model has no reset time but another browser model does — wait for it, finish there", async () => {
      const worker = new KimiOut(0)
      setTimeout(() => (worker.quotaLeft = 5), 300)
      const bus = new EventBus()
      const events = collect(bus)
      const exec = new Executor(mk([{ id: "b", browser: true, primary: "antigravity:gemini-3.8-flash-high", fallbacks: [KIMI] }]), () => worker, bus, { models: M2 })
      expect(await exec.start()).toBe("completed")
      expect(events.some((e) => e.type === "subtask.deferred" && e.until > 0)).toBe(true)
      expect(worker.jobs.map((j) => j.modelId)).toEqual(["antigravity:gemini-3.8-flash-high", KIMI, "antigravity:gemini-3.8-flash-high"])
    }, 10_000)
    it("before starting: the primary is dead with no reset time — wait for the earliest known reset and start on that model", async () => {
      const worker = new KimiOut(0)
      const bus = new EventBus()
      const events = collect(bus)
      const exec = new Executor(
        mk([
          { id: "a", browser: false, primary: KIMI, fallbacks: ["antigravity:gemini-3.8-flash-high", "codex:gpt-5.6-terra"] },
          { id: "b", browser: true, primary: KIMI, fallbacks: [], dependsOn: ["a"] },
        ]),
        () => worker,
        bus,
        { models: M2 },
      )
      setTimeout(() => (worker.quotaLeft = 5), 300)
      expect(await exec.start()).toBe("completed")
      const bJobs = worker.jobs.filter((j) => j.subtask.id === "b").map((j) => j.modelId)
      expect(bJobs).toEqual(["antigravity:gemini-3.8-flash-high"])
      expect(events.some((e) => e.type === "subtask.deferred" && e.subtaskId === "b" && e.until > 0)).toBe(true)
    }, 10_000)
  })
  it("Antigravity briefs forbid manage_task polling", async () => {
    const worker = new QuotaWorker(10)
    const exec = new Executor(browserRun(1), () => worker, new EventBus(), { models: MODELS })
    await exec.start()
    expect(worker.jobs[0]!.brief).toMatch(/manage_task/)
  })
})

describe("Devret: handover in every state with a repo-aware brief (2026-10-05)", () => {
  const MODELS = [
    { id: "gemini-3.8-flash-high", providerId: "antigravity" as const, displayName: "Gemini 3.8 Flash", source: "catalog" as const, tier: "fast" as const },
    { id: "gpt-5.6-terra", providerId: "codex" as const, displayName: "Terra", source: "catalog" as const, tier: "strong" as const },
    { id: "sonnet", providerId: "claude" as const, displayName: "Claude Sonnet", source: "alias" as const, tier: "strong" as const },
  ]
  const POOL = ["antigravity:gemini-3.8-flash-high", "codex:gpt-5.6-terra"]
  const mkRun = (n: number, opts: { browser?: boolean; attempts?: boolean } = {}): SilentCodeRun => {
    const plan = Array.from({ length: n }, (_, i) => ({ id: `t${i}`, runId: "run_h", kind: "testing" as SubtaskKind, title: `Task ${i}`, description: "do it", dependsOn: [], state: "waiting" as const, attempts: opts.attempts ? [{ n: 1, modelId: "antigravity:gemini-3.8-flash-high", startedAt: 1, finishedAt: 2, outcome: "failure" as const, cause: "initial" as const, error: "Individual quota reached. Resets in 3h" }] : [], files: ["src/a.ts"], commands: [], weight: 1 as const, progress: 0, lastUpdate: 0, answers: [], deviations: [], needsBrowser: opts.browser ?? true, summary: opts.attempts ? "half done" : undefined }))
    const routing = plan.map((p) => ({ subtaskId: p.id, kind: p.kind, primaryModelId: POOL[0]!, fallbackModelIds: [], reason: "x", score: 1 }))
    return { id: "run_h", title: "h", prompt: "h", modelPool: POOL, executionMode: "parallel", costMode: "balanced", plan, routing, status: "planned", estimate: { minutes: 1, tokens: 1, costUsd: 0 } as never, createdAt: 0 } as SilentCodeRun
  }
  class W implements Worker {
    readonly id = "w"
    jobs: WorkerJob[] = []
    readonly agyQuotaOut: boolean
    constructor(agyQuotaOut: boolean) {
      this.agyQuotaOut = agyQuotaOut
    }
    supports() {
      return true
    }
    start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
      this.jobs.push(job)
      sink.session(`s-${this.jobs.length}`)
      const out = this.agyQuotaOut && job.modelId.startsWith("antigravity:")
      const done = new Promise<import("./workers/Worker").WorkerResult>((resolve) => setTimeout(() => resolve(out ? { ok: false, summary: "quota", error: "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 0h0m30s.", retryable: false } : { ok: true, summary: "done" }), 15))
      return { done, cancel: async () => {} }
    }
  }
  const repoState = async (files: string[]) => ({ text: `M ${files.join(", ")}\n--- 1 file changed`, snapshot: "refs/silent/snapshots/42" })

  it("a task waiting for a quota reset is handed over at once, with earlier attempts, repo state and the safety snapshot in the brief", async () => {
    const worker = new W(true)
    const bus = new EventBus()
    const events = collect(bus)
    const exec = new Executor(mkRun(1), () => worker, bus, { models: MODELS, repoState })
    const started = Date.now()
    const done = exec.start()
    // wait until the task is in its quota wait, then hand it over to Claude
    for (let i = 0; i < 100 && !events.some((e) => e.type === "subtask.deferred" && e.until > 0); i++) await new Promise((r) => setTimeout(r, 10))
    expect(exec.requestHandover("t0", "claude:sonnet")).toBe(true)
    expect(await done).toBe("completed")
    expect(Date.now() - started).toBeLessThan(10_000)
    const last = worker.jobs.at(-1)!
    expect(last.modelId).toBe("claude:sonnet")
    expect(last.brief).toContain("# HANDOVER")
    expect(last.brief).toMatch(/antigravity:gemini-3\.8-flash-high · initial · failure/)
    expect(last.brief).toContain("## Repository state")
    expect(last.brief).toContain("M src/a.ts")
    expect(last.brief).toContain("Safety snapshot: refs/silent/snapshots/42")
    expect(events.some((e) => e.type === "worker.log" && /handed over "Task 0" → claude:sonnet \(repo snapshot refs\/silent\/snapshots\/42\)/.test(e.line.text))).toBe(true)
  }, 15_000)
  it("a queued task handed over starts on the chosen model", async () => {
    const worker = new W(false)
    const exec = new Executor(mkRun(2, { browser: false }), () => worker, new EventBus(), { models: MODELS, concurrency: () => 1 })
    const done = exec.start()
    expect(exec.requestHandover("t1", "claude:sonnet")).toBe(true)
    expect(await done).toBe("completed")
    expect(worker.jobs.map((j) => j.modelId)).toEqual(["antigravity:gemini-3.8-flash-high", "claude:sonnet"])
  })
  it("a browser task cannot be handed to a CLI that cannot open a browser; unknown models are refused", () => {
    const exec = new Executor(mkRun(1), () => new W(false), new EventBus(), { models: MODELS })
    expect(exec.requestHandover("t0", "codex:gpt-5.6-terra")).toBe(false)
    expect(exec.requestHandover("t0", "nope:model")).toBe(false)
  })
  it("a resumed task with earlier attempts continues with a handover brief", async () => {
    const worker = new W(false)
    const exec = new Executor(mkRun(1, { attempts: true }), () => worker, new EventBus(), { models: MODELS, repoState })
    expect(await exec.start()).toBe("completed")
    const first = worker.jobs[0]!
    expect(first.brief).toContain("# HANDOVER")
    expect(first.brief).toContain("resumed after failure on antigravity:gemini-3.8-flash-high")
    expect(first.brief).toContain("half done")
  })
})
