import { describe, expect, it } from "vitest"
import type { Blueprint } from "@/domain"
import { aiChainFrom, composeAiInput, lintBlueprint, resolveAutorun, validateEdge } from "./graph"

function bp(): Blueprint {
  return {
    id: "bp1",
    name: "t",
    createdAt: 0,
    updatedAt: 0,
    nodes: [
      { id: "p", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "Mimar", text: "Build a game" } },
      { id: "a", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "codex:gpt-6-astra", mode: "single" } },
      { id: "b", type: "build", x: 0, y: 0, data: { type: "build", title: "loki 2", folderPath: "/tmp/loki2", kind: "code" } },
      { id: "p2", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "TR", text: "Add Turkish" } },
      { id: "a2", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "grok:grok-4.7", mode: "single" } },
      { id: "s", type: "button", x: 0, y: 0, data: { type: "button", kind: "start" } },
    ],
    edges: [
      { id: "e1", from: "s", to: "p" },
      { id: "e2", from: "p", to: "a" },
      { id: "e3", from: "a", to: "b" },
      { id: "e4", from: "b", to: "p2" },
      { id: "e5", from: "p2", to: "a2" },
    ],
  }
}

describe("blueprint graph", () => {
  it("follows wires from Start through prompts, AIs and builds", () => {
    expect(aiChainFrom(bp(), "s").map((n) => n.id)).toEqual(["a", "a2"])
  })
  it("composes an AI's input from wired prompts and build context", () => {
    const g = bp()
    expect(composeAiInput(g, "a").prompt).toBe("# Mimar\nBuild a game")
    const second = composeAiInput(g, "a2")
    expect(second.prompt).toBe("# TR\nAdd Turkish")
    expect(second.buildFolders).toEqual(["/tmp/loki2"])
  })
  it("rejects wires that break the rules", () => {
    const g = bp()
    expect(validateEdge(g, { from: "p", to: "b" })).toMatch(/no-rule/)
    expect(validateEdge(g, { from: "p", to: "a" })).toBe("duplicate")
    expect(validateEdge(g, { from: "b", to: "a2" })).toBeNull()
  })
  it("lints unwired buttons and AIs without prompts", () => {
    const g = bp()
    g.nodes.push({ id: "r", type: "button", x: 0, y: 0, data: { type: "button", kind: "reload" } })
    g.nodes.push({ id: "a3", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "", mode: "single" } })
    const lint = lintBlueprint(g)
    expect(lint.r).toContain("button.unwired")
    expect(lint.a3).toEqual(expect.arrayContaining(["ai.noPrompt", "ai.noModel"]))
    g.nodes.push({ id: "a4", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "", mode: "orchestration", pool: ["claude:claude-opus-5-5"] } })
    expect(lintBlueprint(g).a4 ?? []).not.toContain("ai.noModel")
  })
  it("resolves a blueprint + node from CLI refs (id, name, title, default start)", () => {
    const g = bp()
    g.id = "bp_x"; g.name = "Örnek: Loki 2"
    g.nodes.push({ id: "s", type: "button", x: 0, y: 0, data: { type: "button", kind: "start" } })
    const ai = g.nodes.find((n) => n.id === "a")
    if (ai?.data.type === "ai") ai.data.title = "Yapımcı"
    const all = [g]
    expect(resolveAutorun(all, { ref: "bp_x", node: "a" })?.node.id).toBe("a")
    expect(resolveAutorun(all, { ref: "örnek: loki 2", node: "Yapımcı" })?.node.id).toBe("a")
    expect(resolveAutorun(all, { ref: "Örnek: Loki 2" })?.node.id).toBe("s")
    expect(resolveAutorun(all, { ref: "nope" })).toBeUndefined()
    expect(resolveAutorun(all, { ref: "bp_x", node: "missing" })).toBeUndefined()
  })
})

describe("uydurma (placeholder) wiring", () => {
  it("composeAiInput reports producer stubs and fill jobs, lint flags an unwired stub", () => {
    const g: Blueprint = {
      id: "b", name: "t", createdAt: 0, updatedAt: 0,
      nodes: [
        { id: "p", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "GDD", text: "Build" } },
        { id: "s", type: "stub", x: 0, y: 0, data: { type: "stub", kinds: ["image", "sfx"], folder: "assets/uydurma" } },
        { id: "a", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:opus", mode: "orchestration" } },
        { id: "f", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "grok:grok-4.7", mode: "single" } },
        { id: "lonely", type: "stub", x: 0, y: 0, data: { type: "stub", kinds: ["music"], folder: "assets/uydurma" } },
      ],
      edges: [
        { id: "e1", from: "p", to: "a" }, { id: "e2", from: "s", to: "a" }, { id: "e3", from: "f", to: "s" },
      ],
    }
    expect(validateEdge(g, { from: "s", to: "a" })).toBe("duplicate")
    expect(validateEdge(g, { from: "p", to: "s" })).toMatch(/no-rule/)
    const producer = composeAiInput(g, "a")
    expect(producer.stubs.map((x) => x.kinds)).toEqual([["image", "sfx"]])
    expect(producer.fills).toEqual([])
    const filler = composeAiInput(g, "f")
    expect(filler.fills).toHaveLength(1)
    expect(filler.stubs).toEqual([])
    const lint = lintBlueprint(g)
    expect(lint.lonely).toContain("stub.unwired")
    expect(lint.s).toBeUndefined()
  })
})
