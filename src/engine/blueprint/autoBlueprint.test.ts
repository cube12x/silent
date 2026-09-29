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
    { key: "photo", type: "buildPhoto", title: "Kareler" },
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
    expect(r?.nodes).toHaveLength(6)
    expect(r?.edges).toHaveLength(6)
  })
  it("materializes: ids, layout columns, illegal/duplicate wires dropped, unknown models replaced, Start added", () => {
    const r = parseAutoBlueprint(RAW)!
    const m = materializeAutoBlueprint(r, TEST_MODELS)
    expect(m.nodes).toHaveLength(7) // + Start
    expect(m.nodes[0].data.type).toBe("button")
    expect(m.edges).toHaveLength(6) // 4 legal + start→gdd + auto-wired photo source
    expect(m.warnings.join("\n")).toMatch(/photo build had no producing AI/)
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
  it("keeps cycles compact: a Build wired back from its follow-up AIs stays in its column", () => {
    const pos = layoutAutoBlueprint(
      [{ key: "s", type: "button", title: "s" }, { key: "p", type: "prompt", title: "p" }, { key: "a", type: "ai", title: "a" }, { key: "b", type: "build", title: "b" }, { key: "p2", type: "prompt", title: "p2" }, { key: "a2", type: "ai", title: "a2" }],
      [{ from: "s", to: "p" }, { from: "p", to: "a" }, { from: "a", to: "b" }, { from: "b", to: "p2" }, { from: "p2", to: "a2" }, { from: "a2", to: "b" }],
    )
    expect(pos.get("b")!.x).toBe(40 + 3 * 300)
    expect(pos.get("a2")!.x).toBe(40 + 5 * 300)
    expect(Math.max(...Array.from(pos.values()).map((p) => p.x))).toBeLessThan(2000)
  })
  it("prefers a Claude planner model", () => {
    expect(pickAutoBlueprintModel(TEST_MODELS)?.providerId).toBe("claude")
  })
  it("keeps an Özel AI's instructions and valid repo urls", () => {
    const res = materializeAutoBlueprint(
      {
        name: "mod",
        summary: "",
        nodes: [
          { key: "p", type: "prompt", title: "Mod", text: "Add double jump" },
          { key: "a", type: "ai", title: "Modder", modelRef: "codex:gpt-6-astra", mode: "single", instructions: " You are the modder. ", repos: ["https://github.com/acme/game", "not a url"] },
          { key: "b", type: "build", title: "Game" },
        ],
        edges: [{ from: "p", to: "a" }, { from: "a", to: "b" }],
      },
      TEST_MODELS,
    )
    const ai = res.nodes.find((n) => n.type === "ai")!
    expect(ai.data.type === "ai" && ai.data.instructions).toBe("You are the modder.")
    expect(ai.data.type === "ai" && ai.data.repos).toEqual([{ url: "https://github.com/acme/game" }])
  })
  it("keeps the Dönüştürücü role and its wiring", () => {
    const res = materializeAutoBlueprint(
      {
        name: "art",
        summary: "",
        nodes: [
          { key: "p", type: "prompt", title: "Art", text: "Draw sprites" },
          { key: "art", type: "ai", title: "Art AI", modelRef: "codex:gpt-6-astra", mode: "single" },
          { key: "g", type: "buildPhoto", title: "Gallery" },
          { key: "c", type: "ai", title: "Dönüştürücü", modelRef: "codex:gpt-6-astra", mode: "single", role: "donusturucu", purpose: "32x32 transparent PNG frames" },
          { key: "i", type: "ai", title: "Integrator", modelRef: "codex:gpt-6-astra", mode: "single" },
        ],
        edges: [{ from: "p", to: "art" }, { from: "art", to: "g" }, { from: "g", to: "c" }, { from: "c", to: "i" }],
      },
      TEST_MODELS,
    )
    const conv = res.nodes.find((n) => n.data.type === "ai" && n.data.role === "donusturucu")!
    expect(conv).toBeTruthy()
    expect(conv.data.type === "ai" && conv.data.purpose).toBe("32x32 transparent PNG frames")
    const gallery = res.nodes.find((n) => n.type === "buildPhoto")!
    expect(res.edges.some((e) => e.from === gallery.id && e.to === conv.id)).toBe(true)
  })
  it("editing an existing blueprint keeps ids, positions, run history and full prompt text of kept nodes", () => {
    const existing = {
      id: "bp9",
      name: "Old",
      createdAt: 0,
      updatedAt: 0,
      nodes: [
        { id: "n_keep_p", type: "prompt" as const, x: 500, y: 700, data: { type: "prompt" as const, title: "Brief", text: "A".repeat(400) + " tail" } },
        { id: "n_keep_ai", type: "ai" as const, x: 800, y: 700, status: "done" as const, executionId: "run_1", data: { type: "ai" as const, title: "Main", modelRef: "codex:gpt-6-astra", mode: "orchestration" as const, tokens: 1234 } },
        { id: "n_gone", type: "build" as const, x: 1100, y: 700, data: { type: "build" as const, title: "Old build", folderPath: "/tmp/x", kind: "code" as const } },
      ],
      edges: [{ id: "e1", from: "n_keep_p", to: "n_keep_ai" }],
    }
    const res = materializeAutoBlueprint(
      {
        name: "Old",
        summary: "",
        nodes: [
          { key: "n_keep_p", type: "prompt", title: "Brief", text: "A".repeat(300) },
          { key: "n_keep_ai", type: "ai", title: "Main", modelRef: "codex:gpt-6-astra", mode: "orchestration", effort: "high" },
          { key: "new_stub", type: "stub", title: "Ses", kinds: ["sfx"], folder: "assets/ses" },
        ],
        edges: [{ from: "n_keep_p", to: "n_keep_ai" }, { from: "new_stub", to: "n_keep_ai" }],
      },
      TEST_MODELS,
      existing,
    )
    const ai = res.nodes.find((n) => n.id === "n_keep_ai")!
    expect(ai.x).toBe(800)
    expect(ai.status).toBe("done")
    expect(ai.executionId).toBe("run_1")
    expect(ai.data.type === "ai" && ai.data.tokens).toBe(1234)
    expect(ai.data.type === "ai" && ai.data.effort).toBe("high")
    const p = res.nodes.find((n) => n.id === "n_keep_p")!
    expect(p.data.type === "prompt" && p.data.text.endsWith(" tail")).toBe(true)
    expect(res.nodes.some((n) => n.id === "n_gone")).toBe(false)
    expect(res.nodes.filter((n) => n.type === "stub")).toHaveLength(1)
    expect(res.warnings.some((w) => w.startsWith("n_gone"))).toBe(true)
  })
})
