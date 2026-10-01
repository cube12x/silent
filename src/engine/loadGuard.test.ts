import { describe, expect, it } from "vitest"
import { concurrencyCap, loadLevel, mapWithLimit, settleLevel } from "./loadGuard"

describe("load guard (Faz 3)", () => {
  it("classifies host load by CPU count and swap", () => {
    expect(loadLevel({ load1: 3, cpus: 8 })).toBe("ok")
    expect(loadLevel({ load1: 9, cpus: 8 })).toBe("high")
    expect(loadLevel({ load1: 17, cpus: 8 })).toBe("critical")
    expect(loadLevel({ load1: 1, cpus: 8, swapUsedPct: 90 })).toBe("ok") // macOS swap sits near 90 % for hours
    expect(loadLevel({ load1: 1, cpus: 8, swapUsedPct: 94 })).toBe("high")
    expect(loadLevel({ load1: 1, cpus: 8, swapUsedPct: 98 })).toBe("critical")
  })
  it("a level change needs two consecutive samples", () => {
    let st = settleLevel("ok", undefined, "high")
    expect(st.level).toBe("ok")
    st = settleLevel(st.level, st.pending, "high")
    expect(st.level).toBe("high")
    st = settleLevel(st.level, st.pending, "ok")
    expect(st.level).toBe("high")
    st = settleLevel(st.level, st.pending, "high")
    expect(st.level).toBe("high")
    expect(st.pending).toBeUndefined()
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
