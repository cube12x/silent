import { describe, expect, it } from "vitest"
import { RECOMMENDED_PROVIDERS, setupReady, shouldOpenSetup } from "./setup"

describe("setup", () => {
  it("recommends five CLIs, planners first", () => {
    expect(RECOMMENDED_PROVIDERS.slice(0, 2)).toEqual(["codex", "claude"])
    expect(RECOMMENDED_PROVIDERS).toHaveLength(5)
  })
  it("is ready only with a planner-capable CLI", () => {
    expect(setupReady(["codex"])).toBe(true)
    expect(setupReady(["claude", "kimi"])).toBe(true)
    expect(setupReady(["kimi", "grok"])).toBe(false)
    expect(setupReady([])).toBe(false)
  })
  it("opens the setup screen once, after detection found nothing", () => {
    const base = { detecting: false, lastDetectedAt: 1, installedCount: 0, pathname: "/" }
    expect(shouldOpenSetup(base)).toBe(true)
    expect(shouldOpenSetup({ ...base, detecting: true })).toBe(false)
    expect(shouldOpenSetup({ ...base, lastDetectedAt: undefined })).toBe(false)
    expect(shouldOpenSetup({ ...base, lastError: "boom" })).toBe(false)
    expect(shouldOpenSetup({ ...base, installedCount: 1 })).toBe(false)
    expect(shouldOpenSetup({ ...base, setupCompletedAt: 5 })).toBe(false)
    expect(shouldOpenSetup({ ...base, pathname: "/setup" })).toBe(false)
  })
})
