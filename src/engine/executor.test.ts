import { describe, expect, it } from "vitest"
import type { SilentCodeRun } from "@/domain"
import { EventBus, type RunEvent } from "./events"
import { Executor } from "./executor"
import { planSubtasks } from "./planner"
import { routeSubtasks } from "./router"
import { estimateRun } from "./estimate"
import { SimulatedWorker } from "./workers/SimulatedWorker"
import { MODEL_BY_ID } from "./capabilities"

function makeRun(prompt: string, pool = Object.keys(MODEL_BY_ID), mode: SilentCodeRun["executionMode"] = "parallel"): SilentCodeRun {
  const plan = planSubtasks({ prompt }, "run_1")
  const routing = routeSubtasks({ subtasks: plan, pool, costMode: "balanced" })
  return {
    id: "run_1",
    title: prompt,
    prompt,
    modelPool: pool,
    executionMode: mode,
    costMode: "balanced",
    plan,
    routing,
    status: "planned",
    estimate: estimateRun(plan, routing, mode),
    createdAt: 0,
  }
}

function collect(bus: EventBus) {
  const events: RunEvent[] = []
  bus.subscribe((e) => events.push(e))
  return events
}

describe("executor", () => {
  it("completes a run when every worker succeeds, respecting dependency order", async () => {
    const run = makeRun("Add a real-time notification system with tests")
    const bus = new EventBus()
    const events = collect(bus)
    const worker = new SimulatedWorker({ speed: 0, failureRate: 0 })
    const exec = new Executor(run, () => worker, bus)
    const outcome = await exec.start()
    expect(outcome).toBe("completed")
    expect(exec.snapshot.every((s) => s.state === "completed")).toBe(true)
    const completedAt = new Map<string, number>()
    events.forEach((e, i) => {
      if (e.type === "subtask.state" && e.state === "completed") completedAt.set(e.subtaskId, i)
    })
    for (const s of run.plan) for (const d of s.dependsOn) expect(completedAt.get(d)!).toBeLessThan(completedAt.get(s.id)!)
    expect(events.at(-1)?.type).toBe("run.completed")
  })

  it("retries once on the same model, then falls back to the next model", async () => {
    const run = makeRun("Build the backend API", ["codex", "claude-sonnet", "claude-opus"], "sequential")
    const bus = new EventBus()
    const events = collect(bus)
    const worker = new SimulatedWorker({ speed: 0, failureRate: 0, script: { backend: ["fail", "fail", "ok"] } })
    const exec = new Executor(run, () => worker, bus, { maxRetriesPerModel: 1 })
    expect(await exec.start()).toBe("completed")
    const backend = exec.snapshot.find((s) => s.kind === "backend")!
    expect(backend.attempts.map((a) => a.cause)).toEqual(["initial", "retry", "fallback"])
    expect(backend.attempts[2].modelId).not.toBe(backend.attempts[0].modelId)
    expect(events.some((e) => e.type === "subtask.retry")).toBe(true)
    expect(events.some((e) => e.type === "subtask.fallback")).toBe(true)
  })

  it("fails the run and blocks dependents when all models are exhausted", async () => {
    const run = makeRun("Build the backend API", ["codex"], "sequential")
    const bus = new EventBus()
    const worker = new SimulatedWorker({ speed: 0, failureRate: 0, script: { backend: ["fail"] } })
    const exec = new Executor(run, () => worker, bus, { maxRetriesPerModel: 0 })
    expect(await exec.start()).toBe("failed")
    const backend = exec.snapshot.find((s) => s.kind === "backend")!
    expect(backend.state).toBe("failed")
    const review = exec.snapshot.find((s) => s.kind === "review")!
    expect(review.state).toBe("failed")
    expect(review.summary).toMatch(/upstream/)
  })

  it("cancel stops everything and reports cancelled", async () => {
    const run = makeRun("Build the backend API", ["codex"], "sequential")
    const bus = new EventBus()
    const worker = new SimulatedWorker({ speed: 1, failureRate: 0 })
    const exec = new Executor(run, () => worker, bus)
    const p = exec.start()
    exec.cancel()
    expect(await p).toBe("cancelled")
    expect(exec.snapshot.every((s) => s.state === "failed")).toBe(true)
  })

  it("estimate is positive and cheaper in parallel wall-clock", () => {
    const seq = makeRun("Add a dashboard and API", undefined, "sequential").estimate
    const par = makeRun("Add a dashboard and API", undefined, "parallel").estimate
    expect(seq.tokens).toBeGreaterThan(0)
    expect(par.seconds).toBeLessThan(seq.seconds)
  })
})
