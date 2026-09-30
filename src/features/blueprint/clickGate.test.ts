import { describe, expect, it } from "vitest"
import { createClickGate } from "./clickGate"

describe("blueprint click gate", () => {
  it("the 4th quick click on the same node is a quad; the 3rd cancels a pending double-click run", () => {
    const g = createClickGate(600)
    expect(g.click("a", 0)).toEqual({ quad: false, cancelPending: false })
    expect(g.click("a", 100)).toEqual({ quad: false, cancelPending: false })
    expect(g.runOnDoubleClick("a", 101)).toBe(true) // the browser fires dblclick after the 2nd click
    expect(g.click("a", 200)).toEqual({ quad: false, cancelPending: true })
    expect(g.click("a", 300)).toEqual({ quad: true, cancelPending: true })
    // the dblclick event that follows the 4th click must not start a run (that restarted finished nodes, 2026-09-30)
    expect(g.runOnDoubleClick("a", 301)).toBe(false)
  })
  it("slow clicks and clicks on another node restart the count", () => {
    const g = createClickGate(600)
    g.click("a", 0)
    g.click("a", 100)
    expect(g.click("b", 150)).toEqual({ quad: false, cancelPending: false })
    expect(g.click("b", 900)).toEqual({ quad: false, cancelPending: false })
    expect(g.click("b", 950)).toEqual({ quad: false, cancelPending: false })
    expect(g.runOnDoubleClick("b", 951)).toBe(true)
  })
  it("a plain double click still runs the node", () => {
    const g = createClickGate(600)
    g.click("a", 0)
    g.click("a", 120)
    expect(g.runOnDoubleClick("a", 121)).toBe(true)
    // after the suppression window a new double click works again
    g.click("a", 200)
    g.click("a", 250)
    g.click("a", 260)
    g.click("a", 270)
    expect(g.runOnDoubleClick("a", 271)).toBe(false)
    g.click("a", 2000)
    g.click("a", 2100)
    expect(g.runOnDoubleClick("a", 2101)).toBe(true)
  })
})
