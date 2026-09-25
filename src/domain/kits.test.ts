import { describe, expect, it } from "vitest"
import { BUILTIN_KITS, detectKit, renderKitBrief } from "./kits"

describe("expert kits", () => {
  it("picks the pixel-art kit only when a pixel keyword is present", () => {
    expect(detectKit("Build a 2D platformer game with a boss")?.id).toBe("game-2d-web")
    expect(detectKit("Build a pixel-art platformer game with a boss")?.id).toBe("pixel-art-game")
    expect(detectKit("Loki vs Odin retro 8-bit action game")?.id).toBe("pixel-art-game")
    expect(detectKit("Add a REST endpoint to the backend service")?.id).toBe("backend-api")
    expect(detectKit("Fix the typo in the docs")).toBeUndefined()
  })
  it("every kit has a brief, a checklist and small-enough https references", () => {
    for (const kit of BUILTIN_KITS) {
      expect(kit.brief.length).toBeGreaterThan(200)
      expect(kit.checklist.length).toBeGreaterThan(2)
      expect(kit.references.length).toBeGreaterThan(0)
      for (const r of kit.references) expect(r.url).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/)
      expect(renderKitBrief(kit).length).toBeLessThan(3500)
    }
  })
})
