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
    expect(plan.map((st) => (st.kind === "ai" ? st.node.id : st.kind === "parallel" ? `par:${st.heads.map((h) => h.id).join("+")}` : `check:${st.node.id}`))).toEqual(["mimar", "par:ses+model+doku", "int"])
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
  it("lints a Dönüştürücü with no asset source wired into it", () => {
    const g = bp()
    const a = g.nodes.find((n) => n.id === "a")!
    a.data = { ...a.data, role: "donusturucu" } as typeof a.data
    // "a" has a prompt wired in but no build/buildPhoto/stub/ai source
    g.edges = g.edges.filter((e) => e.to !== "a" || g.nodes.find((n) => n.id === e.from)?.type === "prompt")
    expect(lintBlueprint(g).a).toEqual(["donusturucu.noSource"])
    g.edges.push({ id: "src", from: g.nodes.find((n) => n.type === "build")!.id, to: "a" })
    expect(lintBlueprint(g).a ?? []).not.toContain("donusturucu.noSource")
  })
  it("lints a lonely Bilinç or Eylem", () => {
    const g = bp()
    const a = g.nodes.find((n) => n.id === "a")!
    a.data = { ...a.data, role: "bilinc" } as typeof a.data
    expect(lintBlueprint(g).a).toEqual(["bilinc.noEylem"])
    const a2 = g.nodes.find((n) => n.id === "a2")!
    a2.data = { ...a2.data, role: "eylem" } as typeof a2.data
    g.edges.push({ id: "e9", from: "a", to: "a2" })
    expect(lintBlueprint(g).a).toBeUndefined()
    expect(lintBlueprint(g).a2).toBeUndefined()
    // an Eylem fed by a Bilinç needs no prompt of its own
    g.edges = g.edges.filter((e) => e.id !== "e5")
    expect(lintBlueprint(g).a2).toBeUndefined()
  })
  it("lints a repo url an Özel AI cannot clone", () => {
    const g = bp()
    const ai = g.nodes.find((n) => n.id === "a")!
    ai.data = { ...ai.data, repos: [{ url: "github.com/acme/engine" }, { url: "" }] } as typeof ai.data
    expect(lintBlueprint(g).a).toEqual(["ai.badRepo"])
    ai.data = { ...ai.data, repos: [{ url: "https://github.com/acme/engine" }] } as typeof ai.data
    expect(lintBlueprint(g).a).toBeUndefined()
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

describe("Denetçi (check) and Keşifçi (recon) wiring (Faz 2)", () => {
  function withCheck(): Blueprint {
    const g = bp()
    g.nodes.push({ id: "chk", type: "check", x: 0, y: 0, data: { type: "check", commands: ["npm run typecheck", "npm test"], maxLines: 40, timeoutSecs: 600 } })
    g.nodes.push({ id: "fix", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", role: "eylem" } })
    g.edges.push({ id: "c1", from: "a", to: "chk" }, { id: "c2", from: "chk", to: "fix" })
    return g
  }
  it("accepts ai→check, build→check and check→ai wires and rejects check→build", () => {
    const g = withCheck()
    expect(validateEdge(g, { from: "b", to: "chk" })).toBeNull()
    expect(validateEdge(g, { from: "chk", to: "b" })).toMatch(/no-rule/)
    expect(validateEdge(g, { from: "p", to: "chk" })).toMatch(/no-rule/)
  })
  it("walkPlan runs the check as its own step and never walks into its fixers (they run only when the check is red)", () => {
    const plan = walkPlan(withCheck(), "s")
    expect(plan.map((st) => (st.kind === "ai" ? st.node.id : st.kind === "check" ? `check:${st.node.id}` : "par"))).toEqual(["a", "check:chk", "a2"])
    expect(aiChainFrom(withCheck(), "s").map((n) => n.id)).toEqual(["a", "a2"])
  })
  it("lints a check with no source and a recon AI with nothing wired after it", () => {
    const g = withCheck()
    g.edges = g.edges.filter((e) => e.id !== "c1")
    expect(lintBlueprint(g).chk).toEqual(["check.noSource"])
    const r = bp()
    const a = r.nodes.find((n) => n.id === "a")!
    a.data = { ...a.data, role: "kesifci" } as typeof a.data
    r.edges = r.edges.filter((e) => e.from !== "a")
    expect(lintBlueprint(r).a).toEqual(["kesifci.noNext"])
  })
})

describe("Faz 4 boxes: Sıra (queue), Anlık Görüntü (snapshot), Çoklu Tarayıcı (verify), Bütçe (budget), Dikiş role", () => {
  function withBoxes(): Blueprint {
    const g = bp()
    g.nodes.push(
      { id: "q", type: "queue", x: 0, y: 0, data: { type: "queue", modelRef: "codex:gpt-6-astra" } },
      { id: "q1", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "step 1", text: "one" } },
      { id: "q2", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "step 2", text: "two" } },
      { id: "snap", type: "snapshot", x: 0, y: 0, data: { type: "snapshot" } },
      { id: "ver", type: "verify", x: 0, y: 0, data: { type: "verify", modelRef: "claude:sonnet", lanes: ["title screen", "level 1"] } },
      { id: "fix", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", role: "eylem" } },
      { id: "bud", type: "budget", x: 0, y: 0, data: { type: "budget", maxTokens: 200000 } },
      { id: "stitch", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", role: "dikis" } },
    )
    // s → p → a → b (existing). b → snap → q (with q1, q2 wired in) → a2; a → ver → fix; bud → a; b → stitch
    g.edges.push(
      { id: "e_b_snap", from: "b", to: "snap" },
      { id: "e_snap_q", from: "snap", to: "q" },
      { id: "e_q1", from: "q1", to: "q" },
      { id: "e_q2", from: "q2", to: "q" },
      { id: "e_q_a2", from: "q", to: "a2" },
      { id: "e_a_ver", from: "a", to: "ver" },
      { id: "e_ver_fix", from: "ver", to: "fix" },
      { id: "e_bud_a", from: "bud", to: "a" },
      { id: "e_b_stitch", from: "b", to: "stitch" },
    )
    return g
  }
  it("accepts the new wires and rejects nonsense", () => {
    const g = withBoxes()
    expect(validateEdge(g, { from: "p", to: "q" })).toBeNull()
    expect(validateEdge(g, { from: "b", to: "ver" })).toBeNull()
    expect(validateEdge(g, { from: "q", to: "b" })).toBeNull()
    expect(validateEdge(g, { from: "bud", to: "b" })).toMatch(/no-rule/)
    expect(validateEdge(g, { from: "ver", to: "b" })).toMatch(/no-rule/)
    expect(validateEdge(g, { from: "p", to: "snap" })).toMatch(/no-rule/)
    expect(validateEdge(g, { from: "snap", to: "s" })).toBeNull() // snapshot → Paralel/Start button
  })
  it("walkPlan: snapshot and queue are their own steps and the walk continues; verify stops before its fixers", () => {
    const g = withBoxes()
    const label = (st: ReturnType<typeof walkPlan>[number]) => (st.kind === "parallel" ? "par" : `${st.kind}:${st.node.id}`)
    const plan = walkPlan(g, "snap").map(label)
    expect(plan).toEqual(["snapshot:snap", "queue:q", "ai:a2"])
    const fromA = walkPlan(g, "a").map(label)
    expect(fromA).toContain("verify:ver")
    expect(fromA).not.toContain("ai:fix")
    // a → b → snap … and b → stitch: the stitch AI runs after the build like any AI
    expect(fromA).toContain("ai:stitch")
    const fromBudget = walkPlan(g, "bud").map(label)
    expect(fromBudget).toHaveLength(6)
    expect(fromBudget).toEqual(expect.arrayContaining(["ai:a", "verify:ver", "snapshot:snap", "ai:stitch", "queue:q", "ai:a2"]))
    expect(fromBudget).not.toContain("ai:fix")
  })
  it("lints the new boxes", () => {
    const g = withBoxes()
    g.edges = g.edges.filter((e) => !["e_q1", "e_q2", "e_a_ver", "e_bud_a", "e_b_snap", "e_b_stitch"].includes(e.id))
    const lint = lintBlueprint(g)
    expect(lint.q).toEqual(["queue.noPrompt"])
    expect(lint.ver).toEqual(["verify.noSource"])
    expect(lint.bud).toEqual(["budget.noAi"])
    expect(lint.snap).toEqual(["snapshot.noSource"])
    expect(lint.stitch).toEqual(["dikis.noSource"])
    const g2 = withBoxes()
    g2.nodes = g2.nodes.map((n) => (n.id === "ver" && n.data.type === "verify" ? { ...n, data: { ...n.data, lanes: [] } } : n))
    expect(lintBlueprint(g2).ver).toEqual(["verify.noLanes"])
  })
})


describe("an AI behind pass-through boxes inherits the project folder", () => {
  it("Build → snapshot → Dikiş and Bölücü → snapshot → Dikiş both resolve to the build folder", () => {
    const g = bp()
    g.nodes.push(
      { id: "snap", type: "snapshot", x: 0, y: 0, data: { type: "snapshot" } },
      { id: "dikis", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", role: "dikis" } },
      { id: "snap2", type: "snapshot", x: 0, y: 0, data: { type: "snapshot" } },
      { id: "dikis2", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", role: "dikis" } },
    )
    g.edges.push({ id: "x1", from: "b", to: "snap" }, { id: "x2", from: "snap", to: "dikis" }, { id: "x3", from: "a", to: "snap2" }, { id: "x4", from: "snap2", to: "dikis2" })
    expect(composeAiInput(g, "dikis").buildFolders).toEqual(["/tmp/loki2"])
    expect(composeAiInput(g, "dikis2").buildFolders).toEqual(["/tmp/loki2"]) // a → b is the base fixture's build
  })
})


describe("Build → AI wires into fixers/stitchers are context only", () => {
  it("a walk through the Build does not start an Eylem fed by a check or a Dikiş behind a snapshot", () => {
    const g = bp()
    g.nodes.push(
      { id: "chk", type: "check", x: 0, y: 0, data: { type: "check", commands: ["npm test"], maxLines: 40, timeoutSecs: 60 } },
      { id: "fix", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", role: "eylem" } },
      { id: "snap", type: "snapshot", x: 0, y: 0, data: { type: "snapshot" } },
      { id: "stitch", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", role: "dikis" } },
    )
    // a → b (build). b → chk → fix, and b → fix (context). a → snap → stitch, and b → stitch (context).
    g.edges.push({ id: "x1", from: "b", to: "chk" }, { id: "x2", from: "chk", to: "fix" }, { id: "x3", from: "b", to: "fix" }, { id: "x4", from: "a", to: "snap" }, { id: "x5", from: "snap", to: "stitch" }, { id: "x6", from: "b", to: "stitch" })
    const plan = walkPlan(g, "s").map((st) => (st.kind === "parallel" ? "par" : `${st.kind}:${st.node.id}`))
    expect(plan).not.toContain("ai:fix")
    expect(plan.filter((p) => p === "ai:stitch")).toHaveLength(1) // reached through the snapshot only
    expect(plan).toContain("check:chk")
  })
})

describe("a walk through a shared Build hub skips the stages that already ran", () => {
  function hub(): Blueprint {
    const ai = (id: string, status?: "done" | "failed") => ({ id, type: "ai" as const, x: 0, y: 0, status, data: { type: "ai" as const, modelRef: "claude:sonnet", mode: "single" as const } })
    return {
      id: "bp2",
      name: "stages",
      createdAt: 0,
      updatedAt: 0,
      nodes: [
        { id: "s", type: "button", x: 0, y: 0, data: { type: "button", kind: "start" } },
        { id: "p1", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "GDD", text: "core" } },
        ai("core", "done"),
        { id: "b", type: "build", x: 0, y: 0, data: { type: "build", title: "game", folderPath: "/tmp/game", kind: "code" } },
        { id: "snap", type: "snapshot", x: 0, y: 0, status: "done", data: { type: "snapshot" } },
        { id: "chk", type: "check", x: 0, y: 0, status: "done", data: { type: "check", commands: ["npm test"] } },
        { id: "p2", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "Update", text: "stage 2" } },
        ai("split2", "done"),
        { id: "p3", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "Online", text: "stage 3" } },
        ai("online", "failed"),
        { id: "p4", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "Update 3", text: "stage 4" } },
        ai("split3"),
        { id: "p5", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "Integrate", text: "stitch" } },
        ai("int"),
      ],
      edges: [
        { id: "e1", from: "s", to: "p1" },
        { id: "e2", from: "p1", to: "core" },
        { id: "e3", from: "core", to: "b" },
        { id: "e4", from: "b", to: "snap" },
        { id: "e5", from: "snap", to: "chk" },
        { id: "e6", from: "b", to: "p2" },
        { id: "e7", from: "p2", to: "split2" },
        { id: "e8", from: "split2", to: "b" },
        { id: "e9", from: "b", to: "p3" },
        { id: "e10", from: "p3", to: "online" },
        { id: "e11", from: "online", to: "b" },
        { id: "e12", from: "b", to: "p4" },
        { id: "e13", from: "p4", to: "split3" },
        { id: "e14", from: "split3", to: "b" },
        { id: "e15", from: "b", to: "p5" },
        { id: "e16", from: "p5", to: "int" },
        { id: "e17", from: "int", to: "b" },
      ],
    } as Blueprint
  }
  const ids = (g: Blueprint, start: string) => walkPlan(g, start).map((s) => (s.kind === "ai" ? s.node.id : s.kind))
  it("a new stage AI writing into the hub runs only itself and the hub's still-idle follow-ups", () => {
    expect(ids(hub(), "split3")).toEqual(["split3", "int"])
  })
  it("re-running a finished stage from its head continues only into what never ran", () => {
    expect(ids(hub(), "split2")).toEqual(["split2", "split3", "int"])
  })
  it("Start walks through everything; Run on the hub Build itself only continues into what never ran", () => {
    expect(aiChainFrom(hub(), "s").map((n) => n.id)).toEqual(["core", "split2", "online", "split3", "int"])
    expect(aiChainFrom(hub(), "b").map((n) => n.id)).toEqual(["split3", "int"])
  })
  it("a Build fed by a single AI stays a plain pipeline step", () => {
    expect(aiChainFrom(bp(), "a").map((n) => n.id)).toEqual(["a", "a2"])
  })
})

describe("a check's downstream splits into fixers and continuation (2026-10-04)", () => {
  function chain(): Blueprint {
    return {
      id: "bp3",
      name: "chain",
      createdAt: 0,
      updatedAt: 0,
      nodes: [
        { id: "s", type: "button", x: 0, y: 0, data: { type: "button", kind: "start" } },
        { id: "b", type: "build", x: 0, y: 0, data: { type: "build", title: "game", folderPath: "/tmp/game", kind: "code" } },
        { id: "chk", type: "check", x: 0, y: 0, data: { type: "check", commands: ["npm test"], maxLines: 40, timeoutSecs: 60 } },
        { id: "fix", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", role: "eylem" } },
        { id: "next", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "lite", title: "Bölücü 2" } },
      ],
      edges: [
        { id: "e1", from: "s", to: "b" },
        { id: "e2", from: "b", to: "chk" },
        { id: "e3", from: "chk", to: "fix" },
        { id: "e4", from: "chk", to: "next" },
      ],
    } as Blueprint
  }
  it("walks on from a Denetçi into a non-Eylem AI (the next stage) but never into its Eylem fixer", () => {
    expect(walkPlan(chain(), "s").map((st) => (st.kind === "ai" ? `ai:${st.node.id}` : st.kind))).toEqual(["check", "ai:next"])
  })
})

describe("Tamirci boxes are never walked from a Build (2026-10-04)", () => {
  it("a stage AI writing into the hub does not start (or get blocked by) the Tamirci wired from that Build", () => {
    const g: Blueprint = {
      id: "bp4",
      name: "t",
      createdAt: 0,
      updatedAt: 0,
      nodes: [
        { id: "b", type: "build", x: 0, y: 0, data: { type: "build", title: "game", folderPath: "/tmp/game", kind: "code" } },
        { id: "tam", type: "ai", x: 0, y: 0, status: "running", data: { type: "ai", modelRef: "claude:sonnet", mode: "single", title: "Tamirci AI", tamirci: true } },
        { id: "p", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "Stage", text: "x" } },
        { id: "split", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "lite" } },
      ],
      edges: [
        { id: "e1", from: "b", to: "tam" },
        { id: "e2", from: "b", to: "p" },
        { id: "e3", from: "p", to: "split" },
        { id: "e4", from: "split", to: "b" },
      ],
    } as Blueprint
    expect(walkPlan(g, "split").map((st) => (st.kind === "ai" ? st.node.id : st.kind))).toEqual(["split"])
    expect(aiChainFrom(g, "b").map((n) => n.id)).toEqual(["split"])
  })
})
