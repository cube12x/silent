import { describe, expect, it } from "vitest"
import type { MindGraph, MindNode } from "@/domain"
import { composeMind, hasThinking, nextPosition, seedGraph, validateMindEdge } from "./graph"

let n = 0
const id = () => `n${++n}`
const model = (role: "bilinc" | "eylem" | "tek", ref: string, x = 0): MindNode => ({ id: id(), type: "model", x, y: 0, data: { type: "model", role, modelRef: ref } })

describe("composeMind", () => {
  it("compiles the seeded canvas into a Bilinç + Eylem pair with tools and workspace", () => {
    const g = seedGraph(id, { bilinc: "claude:opus", eylem: "codex:luna", workspace: "/tmp/ws" })
    const c = composeMind({ graph: g })
    expect(c.kind).toBe("pair")
    expect(c.bilinc?.modelRef).toBe("claude:opus")
    expect(c.eylem?.modelRef).toBe("codex:luna")
    expect(c.workspace).toBe("/tmp/ws")
    expect(c.tools.files).toBe(true)
    expect(c.warnings).toEqual([])
  })
  it("a lone Model box is used directly (single), an empty canvas is none", () => {
    const one = model("tek", "kimi:k3")
    const c = composeMind({ graph: { nodes: [one], edges: [] } })
    expect(c.kind).toBe("single")
    expect(c.single?.modelRef).toBe("kimi:k3")
    expect(c.single?.nodeId).toBe(one.id)
    expect(composeMind({ graph: { nodes: [], edges: [] } })).toMatchObject({ kind: "none", warnings: ["noModel"] })
  })
  it("with a Gateway only wired models join; unwired ones and empty refs are flagged", () => {
    const gw: MindNode = { id: id(), type: "gateway", x: 0, y: 0, data: { type: "gateway", prompt: "senior" } }
    const b = model("bilinc", "claude:opus")
    const e = model("eylem", "")
    const stray = model("eylem", "codex:luna")
    const g: MindGraph = { nodes: [gw, b, e, stray], edges: [{ id: "e1", from: gw.id, to: b.id }, { id: "e2", from: gw.id, to: e.id }] }
    const c = composeMind({ graph: g })
    expect(c.kind).toBe("pair")
    expect(c.gateway).toBe("senior")
    expect(c.eylem?.modelRef).toBe("")
    expect(c.nodeWarnings[stray.id]).toEqual(["unwiredModel"])
    expect(c.nodeWarnings[e.id]).toContain("noModelRef")
    expect(c.warnings).toContain("noWorkspace")
  })
  it("the acting box's OFF switches cut the Araçlar tools; a Düşünme box turns think-aloud on", () => {
    const g = seedGraph(id, { bilinc: "claude:opus", eylem: "codex:luna" })
    const eylem = g.nodes.find((n) => n.data.type === "model" && n.data.role === "eylem")!
    ;(eylem.data as Extract<MindNode["data"], { type: "model" }>).off = { browser: true, network: true }
    const c = composeMind({ graph: g })
    expect(c.tools).toMatchObject({ browser: false, network: false, files: true, shell: true })
    expect(hasThinking(g)).toBe(false)
    g.nodes.push({ id: id(), type: "thinking", x: 0, y: 0, data: { type: "thinking" } })
    expect(hasThinking(g)).toBe(true)
  })
  it("two boxes of the same role flag the extra one", () => {
    const a = model("bilinc", "claude:opus")
    const b = model("bilinc", "claude:sonnet")
    const c = composeMind({ graph: { nodes: [a, b], edges: [] } })
    expect(c.kind).toBe("single")
    expect(c.nodeWarnings[b.id]).toEqual(["twoBilinc"])
  })
})

describe("validateMindEdge / nextPosition", () => {
  it("refuses model→model, unknown rules, duplicates and self loops", () => {
    const g = seedGraph(id)
    const [memory, gateway, bilinc, eylem, tools] = g.nodes
    expect(validateMindEdge(g, bilinc!.id, eylem!.id)).toBe("modelToModel")
    expect(validateMindEdge(g, bilinc!.id, gateway!.id)).toBe("rule")
    expect(validateMindEdge(g, gateway!.id, bilinc!.id)).toBe("duplicate")
    expect(validateMindEdge(g, tools!.id, tools!.id)).toBe("self")
    expect(validateMindEdge(g, memory!.id, bilinc!.id)).toBeNull()
    expect(validateMindEdge(g, "x", bilinc!.id)).toBe("missing")
  })
  it("stacks new boxes under the last one of a column", () => {
    const g = seedGraph(id)
    expect(nextPosition(g, 0)).toEqual({ x: 40, y: 320 })
    expect(nextPosition({ nodes: [], edges: [] }, 2)).toEqual({ x: 600, y: 60 })
  })
})
