import { describe, expect, it } from "vitest"
import type { Blueprint } from "@/domain"
import { aiChainFrom, composeAiInput, lintBlueprint, resolveAutorun, validateEdge, walkPlan } from "./graph"

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
  it("a Paralel button fans out its AIs at once and the chain continues after all of them", () => {
    const g = team()
    const plan = walkPlan(g, "s")
    expect(plan.map((st) => (st.kind === "ai" ? st.node.id : `par:${st.heads.map((h) => h.id).join("+")}`))).toEqual(["mimar", "par:ses+model+doku", "int"])
    expect(aiChainFrom(g, "s").map((n) => n.id)).toEqual(["mimar", "ses", "model", "doku", "int"])
  })
  it("triggering the Paralel button itself fans out first, then runs what is wired after it", () => {
    const plan = walkPlan(team(), "par")
    expect(plan[0]?.kind).toBe("parallel")
    expect(plan.map((st) => (st.kind === "ai" ? st.node.id : "par"))).toEqual(["par", "int"])
  })
  it("a Paralel button wired straight to an AI (no prompt) still counts it as a head", () => {
    const g = team()
    g.edges.push({ id: "ex", from: "par", to: "extra" })
    g.nodes.push({ id: "extra", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "grok:grok-4.7", mode: "single" } })
    const step = walkPlan(g, "par")[0]
    expect(step?.kind === "parallel" && step.heads.map((h) => h.id)).toEqual(["ses", "model", "doku", "extra"])
  })
  it("an AI behind a Paralel button still works inside the Build wired into that button", () => {
    const g = team()
    expect(composeAiInput(g, "ses").buildFolders).toEqual(["/tmp/game"])
    expect(composeAiInput(g, "int").buildFolders).toEqual(["/tmp/game"])
    g.edges.push({ id: "ex", from: "par", to: "extra" })
    g.nodes.push({ id: "extra", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "grok:grok-4.7", mode: "single" } })
    expect(composeAiInput(g, "extra").buildFolders).toEqual(["/tmp/game"])
  })
  it("never walks through an Uydurma stub (a filler must not re-trigger the producer)", () => {
    const g = team()
    g.nodes.push({ id: "st", type: "stub", x: 0, y: 0, data: { type: "stub", kinds: ["sfx"], folder: "assets/ses" } })
    g.edges.push({ id: "es1", from: "st", to: "mimar" }, { id: "es2", from: "ses", to: "st" })
    expect(walkPlan(g, "par").map((st) => (st.kind === "ai" ? st.node.id : "par"))).toEqual(["par", "int"])
    expect(aiChainFrom(g, "s").map((n) => n.id)).toEqual(["mimar", "ses", "model", "doku", "int"])
  })
  it("lints an unwired Paralel button", () => {
    const g = team()
    g.edges = g.edges.filter((e) => e.from !== "par")
    expect(lintBlueprint(g).par).toEqual(["button.unwired"])
  })
})

/** Start → Tasarım → Mimar → Build → Paralel → 3 filler prompts → 3 filler AIs → Build → Entegrasyon → Entegratör. */
function team(): Blueprint {
  const ai = (id: string): Blueprint["nodes"][number] => ({ id, type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "kimi:kimi-code/x", mode: "single" } })
  const prompt = (id: string): Blueprint["nodes"][number] => ({ id, type: "prompt", x: 0, y: 0, data: { type: "prompt", title: id, text: id } })
  return {
    id: "bp2",
    name: "team",
    createdAt: 0,
    updatedAt: 0,
    nodes: [
      { id: "s", type: "button", x: 0, y: 0, data: { type: "button", kind: "start" } },
      prompt("gdd"),
      ai("mimar"),
      { id: "b", type: "build", x: 0, y: 0, data: { type: "build", title: "game", folderPath: "/tmp/game", kind: "code" } },
      { id: "par", type: "button", x: 0, y: 0, data: { type: "button", kind: "parallel" } },
      prompt("p_ses"),
      ai("ses"),
      prompt("p_model"),
      ai("model"),
      prompt("p_doku"),
      ai("doku"),
      prompt("p_int"),
      ai("int"),
    ],
    edges: [
      { id: "e1", from: "s", to: "gdd" },
      { id: "e2", from: "gdd", to: "mimar" },
      { id: "e3", from: "mimar", to: "b" },
      // The integration prompt is wired from Build BEFORE the Paralel button: order must still be fillers → integrator.
      { id: "e4", from: "b", to: "p_int" },
      { id: "e5", from: "p_int", to: "int" },
      { id: "e6", from: "b", to: "par" },
      { id: "e7", from: "par", to: "p_ses" },
      { id: "e8", from: "p_ses", to: "ses" },
      { id: "e9", from: "par", to: "p_model" },
      { id: "e10", from: "p_model", to: "model" },
      { id: "e11", from: "par", to: "p_doku" },
      { id: "e12", from: "p_doku", to: "doku" },
      { id: "e13", from: "ses", to: "b" },
      { id: "e14", from: "model", to: "b" },
      { id: "e15", from: "doku", to: "b" },
      { id: "e16", from: "int", to: "b" },
    ],
  }
}
