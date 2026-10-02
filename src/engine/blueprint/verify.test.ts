import { describe, expect, it } from "vitest"
import { judgeLanes, laneCap } from "./verify"

describe("Çoklu Tarayıcı lane verdicts (2026-10-02)", () => {
  it("separates OK, real findings and inconclusive lanes", () => {
    const v = judgeLanes([
      { lane: "a", ok: true, text: "# VERIFY\n- OK" },
      { lane: "b", ok: true, text: "# VERIFY\n- [high] inventory: slot 3 shows the wrong icon; expected pickaxe; repro: press 3" },
      { lane: "c", ok: true, text: "# VERIFY\n- INCONCLUSIVE: the machine is overloaded, the game loop does not advance" },
      { lane: "d", ok: false, text: "" },
      { lane: "e", ok: true, text: "# VERIFY\n- [blocker] Lane not verified: load average was about 520 while the other lanes ran Chromium" },
    ])
    expect(v.ok).toEqual(["a"])
    expect(v.findings.map((f) => f.lane)).toEqual(["b"])
    expect(v.inconclusive.map((f) => f.lane)).toEqual(["c", "d", "e"])
  })
  it("a lane whose process failed but still wrote real findings keeps them", () => {
    const v = judgeLanes([{ lane: "a", ok: false, text: "# VERIFY\n- [high] crash on New Game: TypeError in world.ts" }])
    expect(v.findings.map((f) => f.lane)).toEqual(["a"])
    expect(v.inconclusive).toEqual([])
  })
  it("caps lanes at two on an idle host and one under load (each lane is a build + a browser)", () => {
    expect(laneCap("ok", Infinity)).toBe(2)
    expect(laneCap("ok", 1)).toBe(1)
    expect(laneCap("high", 2)).toBe(1)
    expect(laneCap("critical", 1)).toBe(1)
  })
})
