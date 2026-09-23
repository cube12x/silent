import { describe, expect, it } from "vitest"
import { nextModel, routeSubtasks } from "./router"
import { planSubtasks } from "./planner"
import { MODEL_BY_ID } from "./capabilities"

const ALL = Object.keys(MODEL_BY_ID)

describe("router", () => {
  const plan = planSubtasks({ prompt: "Add a real-time notification system with an optimised ranking algorithm and tests" })

  it("routes each kind to its natural specialist in max-quality mode", () => {
    const routes = routeSubtasks({ subtasks: plan, pool: ALL, costMode: "max-quality" })
    const byKind = Object.fromEntries(routes.map((r) => [r.kind, r.primaryModelId]))
    expect(byKind.architecture).toBe("claude-opus")
    expect(byKind.algorithm).toBe("fable-ultracode")
    expect(byKind.tests).toBe("gemini")
    expect(byKind.review).toBe("claude-opus")
  })

  it("never routes outside the enabled pool", () => {
    const pool = ["codex", "glm"]
    const routes = routeSubtasks({ subtasks: plan, pool, costMode: "balanced" })
    for (const r of routes) {
      expect(pool).toContain(r.primaryModelId)
      r.fallbackModelIds.forEach((f) => expect(pool).toContain(f))
    }
  })

  it("zero-api mode only allows free models and reports when none fit", () => {
    const routes = routeSubtasks({ subtasks: plan, pool: ALL, costMode: "zero-api" })
    routes.forEach((r) => expect(r.primaryModelId).toBe("glm"))
    const none = routeSubtasks({ subtasks: plan, pool: ["codex"], costMode: "zero-api" })
    expect(none[0].primaryModelId).toBe("")
    expect(none[0].reason).toMatch(/cost mode/i)
  })

  it("economy mode prefers cheaper models over frontier ones", () => {
    const routes = routeSubtasks({ subtasks: plan, pool: ALL, costMode: "economy" })
    const arch = routes.find((r) => r.kind === "architecture")!
    expect(arch.primaryModelId).not.toBe("fable-ultracode")
  })

  it("honours overrides only when the override is in the pool", () => {
    const routes = routeSubtasks({ subtasks: plan, pool: ALL, costMode: "balanced", overrides: { tests: "codex" } })
    expect(routes.find((r) => r.kind === "tests")!.primaryModelId).toBe("codex")
    const out = routeSubtasks({ subtasks: plan, pool: ["gemini", "glm"], costMode: "balanced", overrides: { tests: "codex" } })
    expect(out.find((r) => r.kind === "tests")!.primaryModelId).toBe("gemini")
  })

  it("falls back, then escalates to a higher tier, then gives up", () => {
    const decision = { subtaskId: "x", kind: "backend" as const, primaryModelId: "codex", fallbackModelIds: ["claude-sonnet"], reason: "", score: 1 }
    expect(nextModel(decision, ["codex"], ALL)).toEqual({ modelId: "claude-sonnet", cause: "fallback" })
    const esc = nextModel(decision, ["codex", "claude-sonnet"], ALL)
    expect(esc?.cause).toBe("escalation")
    expect(MODEL_BY_ID[esc!.modelId].tier).toBe("frontier")
    expect(nextModel(decision, ALL, ALL)).toBeNull()
  })
})
