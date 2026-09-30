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

describe("executor", () => {
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
    expect(backend.attempts.map((a) => a.cause)).toEqual(["initial", "fallback"])
    expect(backend.attempts[1].modelId).not.toBe(backend.attempts[0].modelId)
    expect(events.some((e) => e.type === "subtask.fallback")).toBe(true)
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
