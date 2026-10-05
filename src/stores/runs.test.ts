import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SilentCodeRun } from "@/domain"
import { applyEvent, useRunsStore, _persistChain } from "./runs"

const calls: string[] = []
let upsertDelayMs = 0
vi.mock("@/services", () => ({
  getBackend: async () => ({
    db: {
      runs: {
        upsert: async (r: SilentCodeRun) => {
          if (upsertDelayMs) await new Promise((res) => setTimeout(res, upsertDelayMs))
          calls.push(`upsert:${r.id}`)
        },
        delete: async (id: string) => {
          calls.push(`delete:${id}`)
        },
      },
      terminal: { append: async () => undefined, listBySubtask: async () => [] },
    },
  }),
}))

const run = (): SilentCodeRun => ({ id: "r1", title: "t", prompt: "p", modelPool: [], executionMode: "parallel", costMode: "balanced", status: "running", estimate: { tokens: 0, costUsd: 0, minutes: 0 }, plan: [{ id: "t1", runId: "r1", kind: "backend", title: "A", description: "", dependsOn: [], state: "coding", attempts: [{ n: 1, modelId: "m", startedAt: 1, outcome: "running", cause: "initial" }], files: [], commands: [], weight: 1, progress: 10, lastUpdate: 1, answers: [], deviations: [] }], routing: [], createdAt: 1 } as unknown as SilentCodeRun)

describe("runs reducer keeps failure reasons (2026-10-05 R6)", () => {
  it("subtask.state failed with an error closes the running attempt as a failure with that error", () => {
    const next = applyEvent(run(), { type: "subtask.state", runId: "r1", subtaskId: "t1", state: "failed", progress: 10, error: "boom", at: 5 })
    const st = next.plan[0]!
    expect(st.state).toBe("failed")
    expect(st.attempts[0]).toMatchObject({ outcome: "failure", error: "boom", finishedAt: 5 })
    expect(st.summary).toBe("boom")
  })
  it("run.failed records the reason on the run", () => {
    const next = applyEvent(run(), { type: "run.failed", runId: "r1", reason: "Failed: A", at: 9 })
    expect(next.status).toBe("failed")
    expect(next.report?.notes).toContain("Failed: A")
    expect(next.finishedAt).toBe(9)
  })
})

describe("remove() waits for the run's pending persistence (2026-10-05 R11)", () => {
  beforeEach(() => {
    calls.length = 0
    upsertDelayMs = 30
    useRunsStore.setState({ runs: [run()], executors: {} })
  })
  it("the delete lands after the queued upsert, so a deleted run cannot come back", async () => {
    const backend = { db: { runs: { upsert: async (r: SilentCodeRun) => { await new Promise((res) => setTimeout(res, 30)); calls.push(`upsert:${r.id}`) } } } }
    _persistChain("r1", () => backend.db.runs.upsert(run()))
    await useRunsStore.getState().remove("r1")
    expect(calls).toEqual(["upsert:r1", "delete:r1"])
    expect(useRunsStore.getState().runs).toEqual([])
    // a persist queued after removal is dropped
    _persistChain("r1", () => backend.db.runs.upsert(run()))
    await new Promise((res) => setTimeout(res, 60))
    expect(calls).toEqual(["upsert:r1", "delete:r1"])
  })
})
