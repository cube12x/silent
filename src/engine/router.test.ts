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

  it("keeps browser-driving tasks off CLIs whose sandbox cannot launch a browser (Codex)", () => {
    const tests = plan.filter((s) => s.kind === "tests").map((s) => ({ ...s, needsBrowser: true }))
    expect(tests.length).toBeGreaterThan(0)
    const routes = routeSubtasks({ subtasks: tests, pool: TEST_POOL, models: TEST_MODELS, costMode: "balanced" })
    for (const r of routes) {
      expect(r.primaryModelId.split(":")[0]).not.toBe("codex")
      r.fallbackModelIds.forEach((f) => expect(f.split(":")[0]).not.toBe("codex"))
    }
    // Without the flag Codex stays eligible.
    const plain = routeSubtasks({ subtasks: plan.filter((s) => s.kind === "tests"), pool: ["codex:gpt-5.5-mini"], models: TEST_MODELS, costMode: "balanced" })
    expect(plain[0].primaryModelId).toBe("codex:gpt-5.5-mini")
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

  it("escalation and fallback of a browser task never leave browser-capable CLIs", () => {
    const tests = plan.filter((s) => s.kind === "tests").map((s) => ({ ...s, needsBrowser: true }))
    const [route] = routeSubtasks({ subtasks: tests, pool: ["claude:sonnet", "codex:gpt-6-astra"], models: TEST_MODELS, costMode: "balanced" })
    expect(route.primaryModelId).toBe("claude:sonnet")
    // Sonnet exhausted: Astra is the only higher tier left but cannot launch a browser → no escalation.
    expect(nextModel(route, ["claude:sonnet"], ["claude:sonnet", "codex:gpt-6-astra"], TEST_MODELS, true)).toBeNull()
    // Without the browser constraint the same call escalates to Astra.
    expect(nextModel(route, ["claude:sonnet"], ["claude:sonnet", "codex:gpt-6-astra"], TEST_MODELS, false)?.modelId).toBe("codex:gpt-6-astra")
  })

  it("spreads equal-score work across the pool instead of piling on the first model", () => {
    const twins = [
      { ...TEST_MODELS[1], id: "m-a", providerId: "codex" as const, displayName: "A" },
      { ...TEST_MODELS[1], id: "m-b", providerId: "codex" as const, displayName: "B" },
    ]
    const tasks = plan.slice(0, 2).map((s, i) => ({ ...s, kind: "backend" as const, id: `t${i}`, dependsOn: [] }))
    expect(tasks).toHaveLength(2)
    const routes = routeSubtasks({ subtasks: tasks, pool: ["codex:m-a", "codex:m-b"], models: twins, costMode: "economy" })
    expect(new Set(routes.map((r) => r.primaryModelId)).size).toBe(2)
  })

  it("honours the planner's per-task model choice when it is in the pool, but never for browser tasks on sandboxed CLIs", () => {
    const tasks = plan.slice(0, 2).map((s, i) => ({ ...s, id: `h${i}`, dependsOn: [], modelHint: "codex:gpt-6-astra" }))
    const routes = routeSubtasks({ subtasks: tasks, pool: TEST_POOL, models: TEST_MODELS, costMode: "economy" })
    expect(routes.every((r) => r.primaryModelId === "codex:gpt-6-astra")).toBe(true)
    expect(routes[0].reason).toMatch(/AI planner chose/)
    const browser = [{ ...tasks[0], id: "hb", needsBrowser: true }]
    const [r] = routeSubtasks({ subtasks: browser, pool: TEST_POOL, models: TEST_MODELS, costMode: "economy" })
    expect(r.primaryModelId.split(":")[0]).toBe("claude")
    // A pool with no browser-capable CLI at all escalates the browser task to the catalog (Astra-only Blueprint node, 2026-09-27).
    const [esc] = routeSubtasks({ subtasks: browser, pool: ["codex:gpt-6-astra"], models: TEST_MODELS, costMode: "economy" })
    expect(esc.primaryModelId.split(":")[0]).toBe("claude")
    const [off] = routeSubtasks({ subtasks: [tasks[0]], pool: TEST_POOL, models: TEST_MODELS, costMode: "economy", honourHints: false })
    expect(off.reason).not.toMatch(/AI planner chose/)
  })
})


describe("nextModel for handovers", () => {
  it("skips excluded (dead) models and, when lateral, steps to a same-tier pool model instead of only escalating", () => {
    const plan = planSubtasks({ prompt: "Build the backend API" }, "r")
    const [decision] = routeSubtasks({ subtasks: plan.filter((s) => s.kind === "backend"), pool: ["codex:gpt-6-astra", "claude:opus", "claude:sonnet"], models: TEST_MODELS, costMode: "balanced" })
    const d = { ...decision, primaryModelId: "codex:gpt-6-astra", fallbackModelIds: ["claude:sonnet"] }
    // fallback list first, but never a dead one
    expect(nextModel(d, ["codex:gpt-6-astra"], ["codex:gpt-6-astra", "claude:opus", "claude:sonnet"], TEST_MODELS, false, { exclude: new Set(["claude:sonnet"]), lateral: true })?.modelId).toBe("claude:opus")
    // lateral: a same-tier (frontier) model is acceptable even though nothing is "higher"
    expect(nextModel({ ...d, fallbackModelIds: [] }, ["claude:opus"], ["claude:opus", "codex:gpt-6-astra"], TEST_MODELS, false, { lateral: true })?.modelId).toBe("codex:gpt-6-astra")
    // without lateral the old escalation-only rule holds
    expect(nextModel({ ...d, fallbackModelIds: [] }, ["claude:opus"], ["claude:opus", "codex:gpt-6-astra"], TEST_MODELS, false)).toBeNull()
  })
})

describe("dosage weights in routing", () => {
  it("a low-weight provider loses ties and the share, a zero-weight provider is never routed to unless pinned", () => {
    const plan = planSubtasks({ prompt: "Build the backend API and the frontend dashboard" }, "r").filter((s) => s.kind === "backend" || s.kind === "frontend")
    const pool = ["codex:gpt-6-astra", "claude:opus"]
    const plain = routeSubtasks({ subtasks: plan, pool, models: TEST_MODELS, costMode: "balanced" })
    const weighted = routeSubtasks({ subtasks: plan, pool, models: TEST_MODELS, costMode: "balanced", weights: { codex: 0.15 } })
    expect(plain.some((d) => d.primaryModelId === "codex:gpt-6-astra")).toBe(true)
    expect(weighted.every((d) => d.primaryModelId === "claude:opus")).toBe(true)
    const none = routeSubtasks({ subtasks: plan, pool, models: TEST_MODELS, costMode: "balanced", weights: { codex: 0 } })
    expect(none.every((d) => d.primaryModelId === "claude:opus" && !d.fallbackModelIds.includes("codex:gpt-6-astra"))).toBe(true)
    const pinned = routeSubtasks({ subtasks: plan, pool, models: TEST_MODELS, costMode: "balanced", weights: { codex: 0 }, overrides: { backend: "codex:gpt-6-astra" } })
    expect(pinned.find((d) => d.kind === "backend")?.primaryModelId).toBe("codex:gpt-6-astra")
  })
})
