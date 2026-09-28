import { describe, expect, it } from "vitest"
import { TEST_MODELS } from "@/engine/testModels"
import { layoutAutoBlueprint, materializeAutoBlueprint, parseAutoBlueprint, pickAutoBlueprintModel } from "./autoBlueprint"

const RAW = JSON.stringify({
  name: "Örnek",
  summary: "test",
  nodes: [
    { key: "gdd", type: "prompt", title: "Tasarım", text: "Build a game" },
    { key: "mimar", type: "ai", title: "Mimar", modelRef: "claude:opus", pool: ["codex:gpt-6-astra", "nope:model"], mode: "orchestration", costMode: "max-quality" },
    { key: "build", type: "build", title: "Oyun" },
    { key: "ressam", type: "ai", title: "Ressam", modelRef: "ghost:x", mode: "single" },
    { key: "reload", type: "button", title: "Reload", kind: "reload" },
  ],
  edges: [
    { from: "gdd", to: "mimar" },
    { from: "mimar", to: "build" },
    { from: "build", to: "ressam" },
    { from: "reload", to: "ressam" },
    { from: "gdd", to: "build" }, // illegal: prompt → build
    { from: "mimar", to: "build" }, // duplicate
  ],
})

describe("auto blueprint", () => {
  it("parses the CLI answer even with prose around the JSON", () => {
    const r = parseAutoBlueprint(`Here you go:\n${RAW}\nDone.`)
    expect(r?.name).toBe("Örnek")
    expect(r?.nodes).toHaveLength(5)
    expect(r?.edges).toHaveLength(6)
  })
  it("materializes: ids, layout columns, illegal/duplicate wires dropped, unknown models replaced, Start added", () => {
    const r = parseAutoBlueprint(RAW)!
    const m = materializeAutoBlueprint(r, TEST_MODELS)
    expect(m.nodes).toHaveLength(6) // + Start
    expect(m.nodes[0].data.type).toBe("button")
    expect(m.edges).toHaveLength(5) // 4 legal + start→gdd
    expect(m.warnings.join("\n")).toMatch(/illegal wire prompt → build/)
    const ressam = m.nodes.find((n) => n.data.type === "ai" && n.data.title === "Ressam")!
    expect(ressam.data.type === "ai" && ressam.data.modelRef).not.toBe("ghost:x")
    const mimar = m.nodes.find((n) => n.data.type === "ai" && n.data.title === "Mimar")!
    expect(mimar.data.type === "ai" && mimar.data.pool).toEqual(["claude:opus", "codex:gpt-6-astra"])
    const xs = new Set(m.nodes.map((n) => n.x))
    expect(xs.size).toBeGreaterThan(2)
  })
  it("lays out by depth", () => {
    const pos = layoutAutoBlueprint(
      [{ key: "a", type: "prompt", title: "a" }, { key: "b", type: "ai", title: "b" }, { key: "c", type: "build", title: "c" }],
      [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    )
    expect(pos.get("a")!.x).toBeLessThan(pos.get("b")!.x)
    expect(pos.get("b")!.x).toBeLessThan(pos.get("c")!.x)
  })
  it("prefers a Claude planner model", () => {
    expect(pickAutoBlueprintModel(TEST_MODELS)?.providerId).toBe("claude")
  })
})
