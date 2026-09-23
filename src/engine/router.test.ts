import { describe, expect, it } from "vitest"
import { nextModel, routeSubtasks } from "./router"
import { planSubtasks } from "./planner"
import { TEST_MODELS, TEST_POOL } from "./testModels"

describe("router (CLI models)", () => {
  const plan = planSubtasks({ prompt: "Add a real-time notification system with an optimised ranking algorithm and tests" })

  it("routes to the strongest CLI per kind in max-quality mode", () => {
    const routes = routeSubtasks({ subtasks: plan, pool: TEST_POOL, models: TEST_MODELS, costMode: "max-quality" })
    const byKind = Object.fromEntries(routes.map((r) => [r.kind, r.primaryModelId]))
    expect(byKind.architecture).toBe("claude:opus")
    expect(byKind.review).toBe("claude:opus")
    // max-quality keeps tests on a strong model, never a frontier one
    expect(byKind.tests).toBe("claude:sonnet")
  })

  it("never routes outside the pool and prefers a different CLI as first fallback", () => {
    const pool = ["codex:gpt-6-astra", "kimi:k3", "codex:gpt-5.5-mini"]
    const routes = routeSubtasks({ subtasks: plan, pool, models: TEST_MODELS, costMode: "balanced" })
    for (const r of routes) {
      expect(pool).toContain(r.primaryModelId)
      r.fallbackModelIds.forEach((f) => expect(pool).toContain(f))
      const primaryCli = r.primaryModelId.split(":")[0]
      if (r.fallbackModelIds.length) expect(r.fallbackModelIds[0].split(":")[0]).not.toBe(primaryCli)
    }
  })

  it("economy mode avoids frontier tiers when a cheaper capable model exists", () => {
    const routes = routeSubtasks({ subtasks: plan, pool: TEST_POOL, models: TEST_MODELS, costMode: "economy" })
    const docs = routes.find((r) => r.kind === "docs")
    if (docs) expect(["claude:haiku", "codex:gpt-5.5-mini", "kimi:kimi-for-coding-highspeed", "gemini:gemini-2.5-pro"]).toContain(docs.primaryModelId)
  })

  it("reports unrouted when the pool is empty", () => {
    const routes = routeSubtasks({ subtasks: plan, pool: [], models: TEST_MODELS, costMode: "balanced" })
    expect(routes[0].primaryModelId).toBe("")
  })

  it("falls back, then escalates to a higher tier, then gives up", () => {
    const decision = { subtaskId: "x", kind: "backend" as const, primaryModelId: "claude:sonnet", fallbackModelIds: ["codex:gpt-6-astra"], reason: "", score: 1 }
    expect(nextModel(decision, ["claude:sonnet"], TEST_POOL, TEST_MODELS)).toEqual({ modelId: "codex:gpt-6-astra", cause: "fallback" })
    const esc = nextModel({ ...decision, fallbackModelIds: [] }, ["claude:haiku"], TEST_POOL, TEST_MODELS)
    expect(esc?.cause).toBe("escalation")
    expect(nextModel(decision, TEST_POOL, TEST_POOL, TEST_MODELS)).toBeNull()
  })
})
