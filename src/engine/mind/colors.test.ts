import { describe, expect, it } from "vitest"
import { modelRefColor, modelRefShort, providerColor } from "./colors"

describe("mind colours", () => {
  it("gives every named CLI its own colour and strangers grey", () => {
    expect(providerColor("claude")).toBe("#f0a35c")
    expect(providerColor("codex")).toBe("#19c37d")
    expect(providerColor("gemini")).toBe("#4c8dff")
    expect(providerColor("nope")).toBe("#a3a3a3")
    expect(providerColor(undefined)).toBe("#a3a3a3")
  })
  it("reads the provider out of a model ref", () => {
    expect(modelRefColor("codex:gpt-5.6-luna")).toBe("#19c37d")
    expect(modelRefShort("codex:gpt-5.6-luna")).toBe("gpt-5.6-luna")
    expect(modelRefShort("claude:")).toBe("claude")
    expect(modelRefShort(undefined)).toBe("?")
  })
})
