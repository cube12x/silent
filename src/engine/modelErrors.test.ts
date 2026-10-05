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
  it("does not mistake the runtime's own timeout text or bare numbers for a rejection (2026-10-05: a timed-out worker marked its model dead)", () => {
    for (const m of [
      "process exceeded 2400 s timeout (2400 s limit reached, stopped at a quiet moment)",
      "src/api.ts:401:5 - error TS2322: Type 'string' is not assignable",
      "Compiled 429 modules in 3.2s",
      "hard limit 4800 s",
    ]) expect(isModelRejected(m), m).toBe(false)
  })
  it("still recognises HTTP-shaped rejections and overload", () => {
    for (const m of ["HTTP 429", "status 401", "overloaded_error: the model is overloaded", "Error 403 Forbidden: unauthorized"]) expect(isModelRejected(m), m).toBe(true)
  })
})
