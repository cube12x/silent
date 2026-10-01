import { describe, expect, it } from "vitest"
import { DOSAGE_WEIGHT, dosageLine, dosageWeights, orderByDosage, pickHandoverTarget } from "./dosage"
import { TEST_MODELS } from "./testModels"

describe("provider dosage (the user's quota plan)", () => {
  const settings = { providerDosage: { codex: "minimal", grok: "minimal", claude: "medium", kimi: "low", gemini: "none" } } as const
  it("maps levels to weights; missing providers are high", () => {
    const w = dosageWeights(settings)
    expect(w.codex).toBe(DOSAGE_WEIGHT.minimal)
    expect(w.claude).toBe(DOSAGE_WEIGHT.medium)
    expect(w.antigravity).toBe(1)
    expect(w.gemini).toBe(0)
  })
  it("orders a pool by weight (stable within a level) and drops none-level models", () => {
    const pool = ["codex:gpt-6-astra", "kimi:k3", "claude:opus", "claude:sonnet", "gemini:gemini-2.5-pro"]
    expect(orderByDosage(pool, dosageWeights(settings))).toEqual(["claude:opus", "claude:sonnet", "kimi:k3", "codex:gpt-6-astra"])
  })
  it("writes the planner line only for providers below high", () => {
    const line = dosageLine(settings, TEST_MODELS)
    expect(line).toMatch(/MODEL DOSAGE/)
    expect(line).toMatch(/codex: minimal/)
    expect(line).toMatch(/at most 2 small tasks/)
    expect(line).toMatch(/claude: medium/)
    expect(line).not.toMatch(/antigravity/)
    expect(dosageLine({}, TEST_MODELS)).toBe("")
  })
  it("picks a handover target for a single session: next pool model by weight, else the fallback, never the dead one", () => {
    const w = dosageWeights(settings)
    expect(pickHandoverTarget({ current: "kimi:k3", pool: ["kimi:k3", "codex:gpt-6-astra", "claude:sonnet"], unavailable: ["kimi:k3"], weights: w, fallbackRef: "claude:opus" })).toBe("claude:sonnet")
    expect(pickHandoverTarget({ current: "kimi:k3", pool: ["kimi:k3"], unavailable: ["kimi:k3"], weights: w, fallbackRef: "claude:opus" })).toBe("claude:opus")
    expect(pickHandoverTarget({ current: "kimi:k3", pool: [], unavailable: ["kimi:k3"], weights: w, fallbackRef: "kimi:k3" })).toBeUndefined()
  })
})
