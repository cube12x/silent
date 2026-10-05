import { describe, expect, it } from "vitest"
import { TEST_MODELS } from "@/engine/testModels"
import { layoutAutoBlueprint, materializeAutoBlueprint, parseAutoBlueprint, pickAutoBlueprintModel, buildAutoBlueprintPrompt } from "./autoBlueprint"

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
  it("tells the designer that asset branches must end in a converter + integration step", () => {
    const p = buildAutoBlueprintPrompt({ request: "a batman platformer with art and audio branches", models: TEST_MODELS, language: "tr", kits: [] })
    expect(p).toMatch(/Asset branches never dead-end/)
    expect(p).toMatch(/Entegrasyon AI/)
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
        removed: ["n_gone"], // additive edits (2026-10-01): an omitted node is kept unless listed here
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

describe("Denetçi in auto blueprints", () => {
  it("materializes a check node with its commands and keeps its wires", () => {
    const res = materializeAutoBlueprint(
      { name: "c", summary: "", nodes: [{ key: "p", type: "prompt", title: "P", text: "x" }, { key: "a", type: "ai", title: "A", modelRef: "codex:gpt-6-astra", mode: "single" }, { key: "k", type: "check", title: "Denetçi", commands: ["npm test"] }, { key: "f", type: "ai", title: "Fix", modelRef: "claude:sonnet", mode: "single", role: "eylem" }], edges: [{ from: "p", to: "a" }, { from: "a", to: "k" }, { from: "k", to: "f" }] },
      TEST_MODELS,
    )
    const chk = res.nodes.find((n) => n.type === "check")!
    expect(chk.data.type === "check" && chk.data.commands).toEqual(["npm test"])
    expect(res.edges.filter((e) => e.from === chk.id || e.to === chk.id)).toHaveLength(2)
    expect(buildAutoBlueprintPrompt({ request: "x", models: TEST_MODELS, language: "tr", kits: [] })).toMatch(/check .*runs the project's own commands/)
  })
})

describe("Faz 4 boxes in auto blueprints", () => {
  it("materializes queue, snapshot, verify and budget nodes, the lite mode and the dikis role", () => {
    const res = materializeAutoBlueprint(
      {
        name: "f4",
        summary: "",
        nodes: [
          { key: "p", type: "prompt", title: "P", text: "x" },
          { key: "bud", type: "budget", title: "Bütçe", maxTokens: 150000 },
          { key: "a", type: "ai", title: "Bölücü", modelRef: "codex:gpt-6-astra", mode: "lite" },
          { key: "b", type: "build", title: "B" },
          { key: "snap", type: "snapshot", title: "Kayıt" },
          { key: "q", type: "queue", title: "Sıra", modelRef: "codex:gpt-6-astra" },
          { key: "ver", type: "verify", title: "Tarayıcı", modelRef: "claude:sonnet", lanes: ["title", "level 1"] },
          { key: "st", type: "ai", title: "Dikiş", modelRef: "claude:sonnet", mode: "single", role: "dikis" },
        ],
        edges: [{ from: "p", to: "a" }, { from: "bud", to: "a" }, { from: "a", to: "b" }, { from: "b", to: "snap" }, { from: "snap", to: "q" }, { from: "p", to: "q" }, { from: "b", to: "ver" }, { from: "ver", to: "st" }],
      },
      TEST_MODELS,
    )
    const by = (t: string) => res.nodes.find((n) => n.type === t)!
    const bud = by("budget").data
    expect(bud.type === "budget" ? bud.maxTokens : undefined).toBe(150000)
    const ver = by("verify").data
    expect(ver.type === "verify" ? ver.lanes : undefined).toEqual(["title", "level 1"])
    const que = by("queue").data
    expect(que.type === "queue" ? que.modelRef : undefined).toBe("codex:gpt-6-astra")
    expect(by("snapshot").data.type).toBe("snapshot")
    expect(res.nodes.find((n) => n.data.type === "ai" && n.data.mode === "lite")).toBeTruthy()
    expect(res.nodes.find((n) => n.data.type === "ai" && n.data.role === "dikis")).toBeTruthy()
    expect(res.edges).toHaveLength(9) // + the Start button the materializer adds
    const p = buildAutoBlueprintPrompt({ request: "x", models: TEST_MODELS, language: "tr", kits: [] })
    for (const word of ["queue", "snapshot", "verify", "budget", "dikis", "lite"]) expect(p).toContain(word)
  })
})


describe("turbo / keepSession in auto blueprints", () => {
  it("materializes the box flags", () => {
    const res = materializeAutoBlueprint(
      { name: "t", summary: "", nodes: [{ key: "p", type: "prompt", title: "P", text: "x" }, { key: "a", type: "ai", title: "A", modelRef: "codex:gpt-6-astra", mode: "orchestration", turbo: true }, { key: "s", type: "ai", title: "S", modelRef: "codex:gpt-6-astra", mode: "single", keepSession: true }], edges: [{ from: "p", to: "a" }, { from: "p", to: "s" }] },
      TEST_MODELS,
    )
    const a = res.nodes.find((n) => n.data.type === "ai" && n.data.title === "A")!.data
    const s = res.nodes.find((n) => n.data.type === "ai" && n.data.title === "S")!.data
    expect(a.type === "ai" && a.turbo).toBe(true)
    expect(s.type === "ai" && s.keepSession).toBe(true)
    expect(buildAutoBlueprintPrompt({ request: "x", models: TEST_MODELS, language: "tr", kits: [] })).toContain("turbo")
  })
})


describe("edits keep what the designer did not mention", () => {
  it("a kept Bütçe keeps its limit and a kept Denetçi its commands when the edit omits them", () => {
    const first = materializeAutoBlueprint(
      { name: "k", summary: "", nodes: [{ key: "p", type: "prompt", title: "P", text: "x" }, { key: "bud", type: "budget", title: "B", maxTokens: 1500000 }, { key: "a", type: "ai", title: "A", modelRef: "codex:gpt-6-astra", mode: "single" }, { key: "k", type: "check", title: "K", commands: ["npm run lint"] }], edges: [{ from: "p", to: "a" }, { from: "bud", to: "a" }, { from: "a", to: "k" }] },
      TEST_MODELS,
    )
    const existing = { id: "bp", name: "k", createdAt: 0, updatedAt: 0, nodes: first.nodes, edges: first.edges }
    const keyOf = (title: string) => first.nodes.find((n) => n.data.type !== "button" && (n.data as { title?: string }).title === title)!.id
    const second = materializeAutoBlueprint(
      { name: "k", summary: "", nodes: [{ key: keyOf("P"), type: "prompt", title: "P", text: "x" }, { key: keyOf("B"), type: "budget", title: "B" }, { key: keyOf("A"), type: "ai", title: "A", modelRef: "codex:gpt-6-astra", mode: "single" }, { key: keyOf("K"), type: "check", title: "K" }], edges: [{ from: keyOf("P"), to: keyOf("A") }, { from: keyOf("B"), to: keyOf("A") }, { from: keyOf("A"), to: keyOf("K") }] },
      TEST_MODELS,
      existing,
    )
    const bud = second.nodes.find((n) => n.data.type === "budget")!.data
    expect(bud.type === "budget" && bud.maxTokens).toBe(1500000)
    const chk = second.nodes.find((n) => n.data.type === "check")!.data
    expect(chk.type === "check" && chk.commands).toEqual(["npm run lint"])
  })
})


describe("additive edits", () => {
  it("keeps existing nodes and wires the designer did not mention; `removed` deletes", () => {
    const first = materializeAutoBlueprint(
      { name: "k", summary: "", nodes: [{ key: "p", type: "prompt", title: "P", text: "x" }, { key: "a", type: "ai", title: "A", modelRef: "codex:gpt-6-astra", mode: "single" }, { key: "k", type: "check", title: "K", commands: ["npm test"] }], edges: [{ from: "p", to: "a" }, { from: "a", to: "k" }] },
      TEST_MODELS,
    )
    const existing = { id: "bp", name: "k", createdAt: 0, updatedAt: 0, nodes: first.nodes, edges: first.edges }
    const idOf = (title: string) => first.nodes.find((n) => n.type !== "button" && (n.data as { title?: string }).title === title)!.id
    const second = materializeAutoBlueprint(
      { name: "k", summary: "", nodes: [{ key: idOf("P"), type: "prompt", title: "P", text: "x" }, { key: idOf("A"), type: "ai", title: "A", modelRef: "codex:gpt-6-astra", mode: "single" }, { key: "q", type: "prompt", title: "Q", text: "y" }], edges: [{ from: idOf("P"), to: idOf("A") }, { from: "q", to: idOf("A") }] },
      TEST_MODELS,
      existing,
    )
    expect(second.nodes.some((n) => n.id === idOf("K"))).toBe(true)
    expect(second.edges.some((e) => e.from === idOf("A") && e.to === idOf("K"))).toBe(true)
    expect(second.nodes.some((n) => n.data.type === "prompt" && n.data.title === "Q")).toBe(true)
    const third = materializeAutoBlueprint(
      { name: "k", summary: "", nodes: [{ key: idOf("P"), type: "prompt", title: "P", text: "x" }, { key: idOf("A"), type: "ai", title: "A", modelRef: "codex:gpt-6-astra", mode: "single" }], edges: [{ from: idOf("P"), to: idOf("A") }], removed: [idOf("K")] },
      TEST_MODELS,
      existing,
    )
    expect(third.nodes.some((n) => n.id === idOf("K"))).toBe(false)
  })
})


describe("edges may reference existing boxes by title", () => {
  it("resolves a title to the existing node id", () => {
    const first = materializeAutoBlueprint(
      { name: "t", summary: "", nodes: [{ key: "p", type: "prompt", title: "P", text: "x" }, { key: "a", type: "ai", title: "Main AI", modelRef: "codex:gpt-6-astra", mode: "single" }], edges: [{ from: "p", to: "a" }] },
      TEST_MODELS,
    )
    const existing = { id: "bp", name: "t", createdAt: 0, updatedAt: 0, nodes: first.nodes, edges: first.edges }
    const aiId = first.nodes.find((n) => n.data.type === "ai")!.id
    const second = materializeAutoBlueprint({ name: "t", summary: "", nodes: [{ key: "bud", type: "budget", title: "Bütçe", maxTokens: 1000 }], edges: [{ from: "bud", to: "Main AI" }] }, TEST_MODELS, existing)
    const bud = second.nodes.find((n) => n.data.type === "budget")!
    expect(second.edges.some((e) => e.from === bud.id && e.to === aiId)).toBe(true)
  })
})


describe("parse keeps edges to boxes the designer did not re-emit", () => {
  it("does not drop an edge whose endpoint is an existing box key", () => {
    const r = parseAutoBlueprint(JSON.stringify({ name: "x", summary: "", nodes: [{ key: "bud", type: "budget", title: "B", maxTokens: 10 }], edges: [{ from: "bud", to: "n_existing_ai" }] }))
    expect(r?.edges).toEqual([{ from: "bud", to: "n_existing_ai" }])
  })
})

describe("Model Plus in auto blueprints (2026-10-05)", () => {
  it("materialises a model box with its fields and keeps its state on edits; the rules and wiring mention it", () => {
    const input = {
      name: "Mario",
      summary: "s",
      nodes: [
        { key: "s", type: "button" as const, title: "Start", kind: "start" as const },
        { key: "b", type: "build" as const, title: "Oyun" },
        { key: "m", type: "model" as const, title: "Model Plus", modelRef: "claude:sonnet", style: "pixel", strict: false },
        { key: "i", type: "ai" as const, title: "Entegrasyon", modelRef: "claude:sonnet", mode: "single" as const },
      ],
      edges: [{ from: "s", to: "b" }, { from: "b", to: "m" }, { from: "m", to: "i" }],
    }
    const bp = materializeAutoBlueprint(input, TEST_MODELS)
    const m = bp.nodes.find((n) => n.type === "model")!
    expect(m.data).toMatchObject({ type: "model", modelRef: "claude:sonnet", style: "pixel", strict: false, folder: "assets/model-plus", requests: [] })
    const kinds = bp.edges.map((e) => `${bp.nodes.find((n) => n.id === e.from)!.type}→${bp.nodes.find((n) => n.id === e.to)!.type}`)
    expect(kinds).toEqual(expect.arrayContaining(["build→model", "model→ai"]))
    // an edit that omits style/strict keeps them and never touches the requests
    const withState = { ...bp, nodes: bp.nodes.map((n) => (n.id === m.id && n.data.type === "model" ? { ...n, data: { ...n.data, requests: [{ id: "mr_x", name: "x", kind: "image" as const, subject: "x", sheetPrompt: "p", target: "assets/model-plus/x", status: "accepted" as const }] } } : n)) }
    const idOf = (t: string) => bp.nodes.find((x) => x.type === t)!.id
    const edited = materializeAutoBlueprint({ name: "Mario", summary: "s", nodes: [{ key: idOf("button"), type: "button", title: "Start", kind: "start" }, { key: idOf("build"), type: "build", title: "Oyun" }, { key: m.id, type: "model", title: "Model Plus 2" }, { key: idOf("ai"), type: "ai", title: "Entegrasyon", modelRef: "claude:sonnet", mode: "single" }], edges: [] }, TEST_MODELS, withState)
    const kept = edited.nodes.find((n) => n.id === m.id)!
    expect(kept.data).toMatchObject({ title: "Model Plus 2", style: "pixel", strict: false })
    expect(kept.data.type === "model" && kept.data.requests).toHaveLength(1)
    const p = buildAutoBlueprintPrompt({ request: "x", models: TEST_MODELS, language: "tr", kits: [] })
    expect(p).toContain("Model Plus")
    expect(p).toContain("model→ai")
  })
})
