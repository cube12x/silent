import { describe, expect, it } from "vitest"
import { runSingleChain } from "./singleChain"
import type { SingleRunResult } from "./single"

const GEMINI = "antigravity:gemini-3.8-flash-high"
const CLAUDE = "claude:fable"
const KIMI = "kimi:kimi-code/kimi-for-coding"
const QUOTA = (s: string) => `Individual quota reached. Please upgrade your subscription to increase your limits. Resets in ${s}.`
const FABLE = "You've reached your Fable limit. Switch to another model, or manage usage credits at claude.ai/settings/usage to continue."

/** Scripted CLI: each ref answers from its queue (last answer repeats). */
function harness(script: Record<string, Partial<SingleRunResult>[]>) {
  const calls: { ref: string; extra?: string }[] = []
  const unavailable: string[] = []
  const logs: string[] = []
  const waits: (number | undefined)[] = []
  let clock = 1_000_000
  const start = (ref: string, extra?: string) => {
    calls.push({ ref, extra })
    const q = script[ref] ?? [{ ok: true }]
    const r = q.length > 1 ? q.shift()! : q[0]!
    return { done: Promise.resolve({ ok: false, text: "", tokens: 10, ...r } as SingleRunResult), cancel: async () => {} }
  }
  return {
    calls,
    unavailable,
    logs,
    waits,
    opts: {
      start,
      onCancel: () => {},
      unavailable: () => unavailable,
      markUnavailable: (ref: string) => void unavailable.push(ref),
      log: (l: string) => void logs.push(l),
      onWait: (u: number | undefined) => void waits.push(u),
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms
        return true
      },
    },
  }
}

describe("single-box model chain (2026-10-05: Sanat AI died after one handover while Gemini's quota had reset)", () => {
  it("recognises Claude's plan limit message as a model rejection", async () => {
    const { isModelRejected } = await import("@/engine/modelErrors")
    expect(isModelRejected(FABLE)).toBe(true)
  })
  it("Gemini out → Claude out → waits for Gemini's announced reset and finishes there with a handover brief", async () => {
    const h = harness({ [GEMINI]: [{ error: QUOTA("7m3s") }, { ok: true, text: "done", tokens: 5 }], [CLAUDE]: [{ error: FABLE, text: "half the sprites" }] })
    const out = await runSingleChain({ ...h.opts, mainRef: GEMINI, pool: [], fallbackRef: CLAUDE })
    expect(out.res.ok).toBe(true)
    expect(out.usedRef).toBe(GEMINI)
    expect(h.calls.map((c) => c.ref)).toEqual([GEMINI, CLAUDE, GEMINI])
    expect(h.calls[2]!.extra).toContain("# HANDOVER")
    expect(h.waits.filter(Boolean).length).toBe(1)
    expect(h.waits.at(-1)).toBeUndefined()
    expect(out.res.tokens).toBe(25)
  })
  it("walks the whole pool before waiting", async () => {
    const h = harness({ [GEMINI]: [{ error: QUOTA("1h") }], [KIMI]: [{ error: "403 You've reached your 5-hour usage limit." }], [CLAUDE]: [{ ok: true }] })
    const out = await runSingleChain({ ...h.opts, mainRef: GEMINI, pool: [GEMINI, KIMI, CLAUDE] })
    expect(out.res.ok).toBe(true)
    expect(h.calls.map((c) => c.ref)).toEqual([GEMINI, KIMI, CLAUDE])
    expect(h.waits).toEqual([])
  })
  it("fails with the reason when nobody announced a reset time", async () => {
    const h = harness({ [GEMINI]: [{ error: "403 You've reached your 5-hour usage limit." }] })
    const out = await runSingleChain({ ...h.opts, mainRef: GEMINI, pool: [] })
    expect(out.res.ok).toBe(false)
    expect(out.res.error).toMatch(/5-hour usage limit/)
    expect(h.logs.some((l) => l.startsWith("✖"))).toBe(true)
  })
  it("a reset beyond the wait cap is not waited for", async () => {
    const h = harness({ [GEMINI]: [{ error: QUOTA("9h") }] })
    const out = await runSingleChain({ ...h.opts, mainRef: GEMINI, pool: [], maxWaitMs: 6 * 3_600_000 })
    expect(out.res.ok).toBe(false)
    expect(h.waits).toEqual([])
  })
  it("a cancelled wait stops the chain", async () => {
    const h = harness({ [GEMINI]: [{ error: QUOTA("5m") }] })
    const out = await runSingleChain({ ...h.opts, mainRef: GEMINI, pool: [], sleep: async () => false })
    expect(out.res.ok).toBe(false)
    expect(out.res.error).toBe("cancelled")
    expect(h.calls.length).toBe(1)
  })
  it("ordinary failures are not handed over", async () => {
    const h = harness({ [GEMINI]: [{ error: "tests failed" }] })
    const out = await runSingleChain({ ...h.opts, mainRef: GEMINI, pool: [GEMINI, CLAUDE] })
    expect(out.res.ok).toBe(false)
    expect(h.calls.length).toBe(1)
  })
})
