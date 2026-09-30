import { describe, expect, it } from "vitest"
import { useRunsStore } from "./runs"

describe("Turbo run preset (Faz 3)", () => {
  it("a Turbo draft turns polish off, caps every task's effort at medium and marks the run", () => {
    const run = useRunsStore.getState().draft({ prompt: "Build the backend API and the frontend dashboard", pool: ["codex:gpt-6-astra"], executionMode: "staged", costMode: "max-quality", turbo: true, effort: "xhigh" })
    expect(run.turbo).toBe(true)
    expect(run.polish).toBe(false)
    expect(run.plan.length).toBeGreaterThan(0)
    expect(run.plan.every((s) => !s.effort || s.effort === "low" || s.effort === "medium")).toBe(true)
  })
  it("without Turbo the explicit effort and polish stay as asked", () => {
    const run = useRunsStore.getState().draft({ prompt: "Build the backend API", pool: ["codex:gpt-6-astra"], executionMode: "staged", costMode: "balanced", effort: "high" })
    expect(run.turbo).toBeUndefined()
    expect(run.polish).toBe(true)
    expect(run.plan.some((s) => s.effort === "high")).toBe(true)
  })
})
