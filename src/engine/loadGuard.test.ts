import { describe, expect, it } from "vitest"
import { concurrencyCap, loadLevel, mapWithLimit } from "./loadGuard"

describe("load guard (Faz 3)", () => {
  it("classifies host load by CPU count and swap", () => {
    expect(loadLevel({ load1: 3, cpus: 8 })).toBe("ok")
    expect(loadLevel({ load1: 9, cpus: 8 })).toBe("high")
    expect(loadLevel({ load1: 17, cpus: 8 })).toBe("critical")
    expect(loadLevel({ load1: 1, cpus: 8, swapUsedPct: 75 })).toBe("high")
    expect(loadLevel({ load1: 1, cpus: 8, swapUsedPct: 95 })).toBe("critical")
  })
  it("caps concurrency to 2 on a busy host and to 1 on a starved one; no cap otherwise", () => {
    expect(concurrencyCap(undefined)).toBe(Infinity)
    expect(concurrencyCap({ load1: 2, cpus: 8 })).toBe(Infinity)
    expect(concurrencyCap({ load1: 10, cpus: 8 })).toBe(2)
    expect(concurrencyCap({ load1: 20, cpus: 8 })).toBe(1)
  })
  it("mapWithLimit never exceeds the live limit and keeps input order", async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapWithLimit([30, 10, 20, 5], () => 2, async (ms) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, ms))
      inFlight -= 1
      return ms * 2
    })
    expect(out).toEqual([60, 20, 40, 10])
    expect(peak).toBe(2)
  })
})
