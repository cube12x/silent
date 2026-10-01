import { describe, expect, it } from "vitest"
import { isModelRejected } from "./modelErrors"

describe("isModelRejected", () => {
  it("recognises quota/limit phrasings of every CLI", () => {
    for (const m of [
      "You have hit your usage limit. Resets at 3pm",
      "You exceeded your current quota, please check your plan",
      "Daily limit reached for claude-opus",
      "429 Too Many Requests",
      "Error: too many requests, slow down",
      "You are out of credits",
      "insufficient_quota",
      "401 Your current subscription does not have access to gpt-6-sol",
    ]) expect(isModelRejected(m), m).toBe(true)
  })
  it("ignores ordinary task failures", () => {
    for (const m of ["tests failed: 3 of 40", "TypeError: cannot read properties of undefined", "exited with code 1", "the function limits the array to 10 items"]) expect(isModelRejected(m), m).toBe(false)
  })
})
