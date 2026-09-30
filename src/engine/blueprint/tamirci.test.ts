import { describe, expect, it } from "vitest"
import type { Blueprint } from "@/domain"
import { extractReport } from "./prompt"
import { findTamirciBoxes, tamirciExtraPrompt } from "./tamirci"

describe("Tamirci AI", () => {
  it("work order lists the problem, the attached files and the report format", () => {
    const p = tamirciExtraPrompt({ problem: "  Flowers clip into the wall on level 1  ", files: ["src/game/world/index.ts", "src/game/content/index.ts"] })
    expect(p).toMatch(/^# Repair request\n\nFlowers clip into the wall on level 1\n\n/)
    expect(p).toContain("- src/game/world/index.ts")
    expect(p).toContain("# FIXED")
    expect(p).toContain("# NOT FIXED")
    expect(tamirciExtraPrompt({ problem: "x", files: [] })).toContain("No files were attached")
  })
  it("the report part of a repair reply starts at # FIXED", () => {
    expect(extractReport("I looked around.\n\n# FIXED\n- a.ts — clamp\n# NOT FIXED\n- none")).toMatch(/^# FIXED/)
  })
  it("finds the repair boxes by their marker, by role", () => {
    const bp = { id: "b", name: "b", createdAt: 0, updatedAt: 0, edges: [], nodes: [
      { id: "n1", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "codex:x", mode: "single" } },
      { id: "n2", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "codex:x", mode: "single", tamirci: true, role: "bilinc" } },
      { id: "n3", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "codex:x", mode: "single", tamirci: true, role: "eylem" } },
    ] } as unknown as Blueprint
    const found = findTamirciBoxes(bp)
    expect(found.bilinc?.id).toBe("n2")
    expect(found.eylem?.id).toBe("n3")
    expect(findTamirciBoxes({ ...bp, nodes: [bp.nodes[0]] })).toEqual({ eylem: undefined, bilinc: undefined })
  })
})
