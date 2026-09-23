import { describe, expect, it } from "vitest"
import { effortFor, timeoutFor } from "./effort"
import { routeSubtasks } from "./router"
import { planSubtasks } from "./planner"
import { TEST_MODELS, TEST_POOL } from "./testModels"

describe("effort policy", () => {
  it("never lets light kinds run at high effort", () => {
    expect(effortFor("docs", "balanced")).toBe("low")
    expect(effortFor("tests", "balanced")).toBe("low")
    expect(effortFor("backend", "balanced")).toBe("medium")
    expect(effortFor("architecture", "balanced")).toBe("high")
    expect(effortFor("architecture", "max-quality")).toBe("xhigh")
    expect(effortFor("tests", "max-quality")).toBe("low")
    expect(effortFor("architecture", "balanced", "fast")).toBe("medium")
    expect(effortFor("backend", "economy")).toBe("low")
  })
  it("bounds review/docs/tests tighter than build work", () => {
    expect(timeoutFor("review", 1)).toBe(900)
    expect(timeoutFor("backend", 3)).toBe(2400)
  })
})

describe("tier-targeted routing", () => {
  const plan = planSubtasks({ prompt: "Build the backend API and the frontend dashboard with tests" })
  it("sends tests to fast, backend to strong, architecture to frontier in balanced mode", () => {
    const byKind = Object.fromEntries(routeSubtasks({ subtasks: plan, pool: TEST_POOL, models: TEST_MODELS, costMode: "balanced" }).map((r) => [r.kind, r.primaryModelId]))
    expect(["claude:haiku", "codex:gpt-5.5-mini", "kimi:kimi-for-coding-highspeed"]).toContain(byKind.tests)
    expect(["claude:sonnet"]).toContain(byKind.backend)
    expect(["claude:opus", "codex:gpt-6-astra", "kimi:k3", "gemini:gemini-2.5-pro"]).toContain(byKind.architecture)
  })
  it("falls back to the nearest tier when the target tier is absent from the pool", () => {
    const pool = ["codex:gpt-6-astra", "claude:opus"]
    const routes = routeSubtasks({ subtasks: plan, pool, models: TEST_MODELS, costMode: "balanced" })
    routes.forEach((r) => expect(pool).toContain(r.primaryModelId))
  })
})
