import { describe, expect, it } from "vitest"
import { interpretGateway, renderGatewayBrief } from "./gateway"

describe("gateway interpreter", () => {
  it("maps the canonical example prompt to role, traits, guardrails and permissions", () => {
    const p = interpretGateway(
      "Act like a senior backend engineer for this repo. Respect current architecture. Check tests before claiming completion. Avoid unnecessary dependencies. Focus on stability and clean code.",
    )
    expect(p.role).toBe("Senior Backend Engineer")
    expect(p.behaviorProfile).toEqual(expect.arrayContaining(["respect-architecture", "verify-with-tests", "minimal-dependencies", "stability-first", "clean-code"]))
    expect(p.guardrails.length).toBeGreaterThanOrEqual(3)
    expect(p.permissions.runTests).toBe(true)
    expect(p.permissions.network).toBe(false)
    expect(p.taskStyle).toBe("surgical")
    expect(p.focusKinds).toContain("backend")
    expect(p.summary).toContain("Senior Backend Engineer")
  })

  it("never enables git push, even when asked", () => {
    const p = interpretGateway("You may commit and push freely.")
    expect(p.permissions.gitPush).toBe(false)
    expect(p.permissions.gitCommit).toBe(true)
  })

  it("handles an empty prompt with sane defaults", () => {
    const p = interpretGateway("")
    expect(p.role).toBe("General Assistant")
    expect(p.taskStyle).toBe("balanced")
    expect(p.qualityExpectations.length).toBeGreaterThan(0)
  })

  it("renders a brief that includes guardrails", () => {
    const brief = renderGatewayBrief(interpretGateway("Never delete files. Security matters."))
    expect(brief).toMatch(/Role:/)
    expect(brief).toMatch(/Never log or commit secrets/)
    expect(brief).toMatch(/Stop and ask before deleting/)
  })
})
