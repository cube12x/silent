import { describe, expect, it } from "vitest"
import type { SilentCodeRun } from "@/domain"
import { EventBus, type RunEvent } from "./events"
import { Executor } from "./executor"
import { planSubtasks } from "./planner"
import { routeSubtasks } from "./router"
import { estimateRun } from "./estimate"
import { effectivePolicy } from "./policy"
import { DEFAULT_SETTINGS } from "@/domain"
import { TEST_MODELS, TEST_POOL } from "./testModels"
import type { Worker, WorkerHandle, WorkerJob, WorkerSink } from "./workers/Worker"

function oneTaskRun(): SilentCodeRun {
  const plan = planSubtasks({ prompt: "Build the backend API, no tests, skip review" }, "run_q").filter((s) => s.kind === "backend").map((s) => ({ ...s, dependsOn: [] }))
  const routing = routeSubtasks({ subtasks: plan, pool: TEST_POOL, models: TEST_MODELS, costMode: "balanced" })
  return { id: "run_q", title: "q", prompt: "q", modelPool: TEST_POOL, executionMode: "sequential", costMode: "balanced", plan, routing, status: "planned", estimate: estimateRun(plan, routing, "sequential"), createdAt: 0 }
}

/** First call asks a question; the answered continuation completes and reports a deviation. */
class AskingWorker implements Worker {
  readonly id = "ask"
  jobs: WorkerJob[] = []
  supports() {
    return true
  }
  start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
    this.jobs.push(job)
    sink.session("sess-1")
    if (this.jobs.length === 1) return { done: Promise.resolve({ ok: false, blocked: true, question: "Licensed sources only?", summary: "", retryable: false }), cancel: () => {} }
    return { done: Promise.resolve({ ok: true, summary: "Done with licensed sources", deviations: ["Used only licensed sources instead of any source"] }), cancel: () => {} }
  }
}

describe("questions, answers, deviations, report", () => {
  it("blocks on SILENT_QUESTION, resumes the same session with the answer, collects deviations into the report", async () => {
    const run = oneTaskRun()
    const bus = new EventBus()
    const events: RunEvent[] = []
    bus.subscribe((e) => events.push(e))
    const worker = new AskingWorker()
    const exec = new Executor(run, () => worker, bus, { models: TEST_MODELS })
    const outcome = exec.start()
    // wait until the executor is blocked on the question
    await new Promise((r) => setTimeout(r, 10))
    expect(exec.snapshot[0].state).toBe("blocked")
    expect(exec.pendingQuestions()[0].question).toBe("Licensed sources only?")
    expect(exec.answer(exec.snapshot[0].id, "Yes, licensed only")).toBe(true)
    expect(await outcome).toBe("completed")
    expect(worker.jobs[1].resumeSessionId).toBe("sess-1")
    expect(worker.jobs[1].brief).toMatch(/Yes, licensed only/)
    expect(exec.snapshot[0].attempts.map((a) => a.cause)).toEqual(["initial", "answer"])
    expect(exec.snapshot[0].deviations).toEqual(["Used only licensed sources instead of any source"])
    const report = events.find((e) => e.type === "run.report")
    expect(report && report.type === "run.report" && report.report.deviations[0]).toMatch(/licensed sources/)
    expect(worker.jobs[0].brief).toMatch(/SILENT_QUESTION/)
  })

  it("cancel releases a blocked subtask", async () => {
    const run = oneTaskRun()
    const exec = new Executor(run, () => new AskingWorker(), new EventBus(), { models: TEST_MODELS })
    const outcome = exec.start()
    await new Promise((r) => setTimeout(r, 10))
    exec.cancel()
    expect(await outcome).toBe("cancelled")
  })
})

describe("manual routing policy", () => {
  it("overrides tiers per kind when manual, falls back to auto otherwise", () => {
    const auto = effectivePolicy(DEFAULT_SETTINGS, "balanced")
    expect(auto.tests).toBe("fast")
    const manual = effectivePolicy({ ...DEFAULT_SETTINGS, routingPolicy: { mode: "manual", table: { tests: { tier: "frontier" } } } }, "balanced")
    expect(manual.tests).toBe("frontier")
    expect(manual.backend).toBe("strong")
    const plan = planSubtasks({ prompt: "Build the backend API with tests" })
    const routes = routeSubtasks({ subtasks: plan, pool: TEST_POOL, models: TEST_MODELS, costMode: "balanced", policy: manual })
    expect(["claude:opus", "codex:gpt-6-astra", "kimi:k3", "gemini:gemini-2.5-pro"]).toContain(routes.find((r) => r.kind === "tests")!.primaryModelId)
  })
})
