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
  private readonly script: Partial<Record<SubtaskKind, Array<"ok" | "fail">>>
  private readonly hang: boolean
  constructor(script: Partial<Record<SubtaskKind, Array<"ok" | "fail">>> = {}, hang = false) {
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
      : Promise.resolve(outcome === "ok" ? { ok: true, summary: `${job.subtask.kind} done by ${job.modelId}` } : { ok: false, summary: "failed", error: `${job.subtask.kind} failed`, retryable: true })
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

  it("fails the run and blocks dependents when every model is exhausted", async () => {
    const run = makeRun("Build the backend API", ["codex:gpt-6-astra"], "sequential")
    const bus = new EventBus()
    const exec = new Executor(run, () => new ScriptedWorker({ backend: ["fail"] }), bus, { maxRetriesPerModel: 0, models: TEST_MODELS })
    expect(await exec.start()).toBe("failed")
    expect(exec.snapshot.find((s) => s.kind === "backend")!.state).toBe("failed")
    expect(exec.snapshot.find((s) => s.kind === "review")!.summary).toMatch(/upstream/)
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
})
