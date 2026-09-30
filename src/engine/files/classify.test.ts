import { describe, expect, it } from "vitest"
import { classifyPrompt, extractIndexJson } from "./classify"
import type { FilesIndex } from "./index"

const idx: FilesIndex = { version: 1, builtAt: 5, root: "/p", items: [{ id: "atlas:hero:murkcap", title: "murkcap", category: "diger", files: ["assets/converted/hero.png"], previews: [] }] }

describe("files classify pass", () => {
  it("prompt is read-only, lists categories, the current index and the tree, and asks for one JSON object", () => {
    const p = classifyPrompt(idx, ["src/game/player/index.ts", "src/render/index.ts"])
    expect(p).toMatch(/READ-ONLY/)
    expect(p).toContain("karakterler")
    expect(p).toContain("sistemler")
    expect(p).toContain("atlas:hero:murkcap")
    expect(p).toContain("src/game/player/index.ts")
    expect(p).toMatch(/one JSON object/)
    expect(p).toMatch(/"ai": true/)
  })
  it("caps the tree it sends", () => {
    const tree = Array.from({ length: 500 }, (_, i) => `src/f${i}.ts`)
    const p = classifyPrompt(idx, tree)
    expect(p).toContain("src/f0.ts")
    expect(p).not.toContain("src/f499.ts")
    expect(p).toMatch(/\+\d+ more/)
  })
  it("extracts the last JSON object from prose and validates it", () => {
    const text = `Sure. Here is the index:\n\`\`\`json\n${JSON.stringify({ ...idx, items: [{ ...idx.items[0], title: "Mario", category: "karakterler", ai: true }] })}\n\`\`\`\nDone.`
    const out = extractIndexJson(text)
    expect(out?.items[0].title).toBe("Mario")
    expect(out?.items[0].category).toBe("karakterler")
    expect(extractIndexJson("no json here")).toBeNull()
    expect(extractIndexJson(JSON.stringify({ version: 1, root: "/p", items: [{ id: "x", title: "x", category: "nope", files: [] }] }))).toBeNull()
  })
})
