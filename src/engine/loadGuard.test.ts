import { describe, expect, it } from "vitest"
import { concurrencyCap, loadLevel, mapWithLimit, settleLevel } from "./loadGuard"

describe("load guard (Faz 3)", () => {
  it("classifies host load by CPU count and swap (fallback without direct measurements)", () => {
    expect(loadLevel({ load1: 3, cpus: 8 })).toBe("ok")
    expect(loadLevel({ load1: 9, cpus: 8 })).toBe("ok") // 2026-10-05: load ≈ cpus is normal on macOS
    expect(loadLevel({ load1: 17, cpus: 8 })).toBe("high")
    expect(loadLevel({ load1: 25, cpus: 8 })).toBe("critical")
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
    expect(concurrencyCap({ load1: 20, cpus: 8 })).toBe(2)
    expect(concurrencyCap({ load1: 30, cpus: 8 })).toBe(1)
  })
  it("direct measurements win over the load average (2026-10-05: load 5.5 on 6 cores with 52 % idle CPU was 'high')", () => {
    expect(loadLevel({ load1: 5.5, cpus: 6, cpuIdlePct: 52, memPressure: 2, swapUsedPct: 88 })).toBe("ok")
    expect(loadLevel({ load1: 40, cpus: 6, cpuIdlePct: 45, memPressure: 1 })).toBe("ok") // a busy load average alone is not starvation
    expect(loadLevel({ load1: 5, cpus: 6, cpuIdlePct: 12, memPressure: 1 })).toBe("high")
    expect(loadLevel({ load1: 5, cpus: 6, cpuIdlePct: 25, memPressure: 2 })).toBe("high")
    expect(loadLevel({ load1: 5, cpus: 6, cpuIdlePct: 3, memPressure: 1 })).toBe("critical")
    expect(loadLevel({ load1: 1, cpus: 6, cpuIdlePct: 80, memPressure: 4 })).toBe("critical")
    expect(loadLevel({ load1: 1, cpus: 6, cpuIdlePct: 80, memPressure: 1, swapUsedPct: 98 })).toBe("critical")
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
