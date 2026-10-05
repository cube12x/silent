import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Blueprint } from "@/domain"
import { useBlueprintsStore } from "./blueprints"

const writes: Record<string, string> = {}
let singleCalls = 0
let reply = ""
let converterPrompt = ""
let disk: string[] = []
let atlasFrames: string[] = []
const imports: Array<{ folder: string; paths: string[] }> = []
const storedNames = new Map<string, number>()
let importGate: Promise<void> | null = null
let capturedPrompts: string[] = []
const PNG = (size: number) => {
  const b = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, size, 0, 0, 0, size, 8, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 73, 68, 65, 84, 0, 0, 0, 0]
  return btoa(String.fromCharCode(...b))
}
vi.mock("@/services", () => ({
  getBackend: async () => ({
    db: { blueprints: { upsert: async () => undefined } },
    projectSweep: async () => 0,
    repoDigest: async () => "src/player.ts: drawPlayer() 64px",
    readProjectFile: async (_r: string, rel: string) => (rel.endsWith("mario.json") && atlasFrames.length ? JSON.stringify({ frameW: 4, frameH: 4, columns: 2, frames: atlasFrames.map((name, i) => ({ name, x: i * 4, y: 0, w: 4, h: 4 })) }) : null),
    writeProjectFile: async (_root: string, rel: string, content: string) => {
      writes[rel] = content
    },
    // outputs are "just written": newer than any delivery in these tests
    listProjectFiles: async () => disk.map((rel) => ({ rel, size: 1, mtimeMs: Date.now() + 60_000 })),
    readProjectBlob: async (_r: string, rel: string) => ({ mime: "image/png", base64: rel.endsWith("/mario.png") ? PNG(8) : PNG(4) }),
    blueprintBuildImportPaths: async (folder: string, paths: string[]) => {
      if (importGate) await importGate
      imports.push({ folder, paths })
      return paths.map((p) => {
        const base = p.split("/").pop() ?? p
        const n = (storedNames.get(base) ?? 0) + 1
        storedNames.set(base, n)
        return n === 1 ? base : base.replace(/(\.[a-z0-9]+)$/i, `-${n}$1`)
      })
    },
    blueprintBuildStats: async () => ({ fileCount: 0, images: [], newestMs: 0 }),
    blueprintWriteTool: async () => "",
    cliStart: async () => { throw new Error("no cli in this test") },
  }),
}))
vi.mock("@/engine/blueprint/single", () => ({
  runSingle: (_backend: unknown, req: { prompt: string }) => {
    singleCalls += 1
    converterPrompt = req.prompt
    capturedPrompts.push(req.prompt)
    return { cancel: async () => undefined, done: Promise.resolve({ ok: true, text: reply, tokens: 11, sessionId: "s" }) }
  },
}))

const bp = (): Blueprint => ({
  id: "b1",
  name: "Mario",
  nodes: [
    { id: "s", type: "button", x: 0, y: 0, data: { type: "button", kind: "start" } },
    { id: "b", type: "build", x: 0, y: 0, data: { type: "build", title: "x", folderPath: "/tmp/x", kind: "code" } },
    { id: "m", type: "model", x: 0, y: 0, data: { type: "model", title: "Model Plus", modelRef: "claude:sonnet", folder: "assets/model-plus", requests: [], strict: true } },
    { id: "next", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", title: "Entegrasyon" } },
  ],
  edges: [{ id: "e1", from: "s", to: "b" }, { id: "e2", from: "b", to: "m" }, { id: "e3", from: "m", to: "next" }],
  createdAt: 1,
  updatedAt: 1,
})

const CONTRACT = `Two assets.
# MODEL_REQUESTS
[{"name":"mario","kind":"sprite-sheet","subject":"Mario","animations":[{"name":"walk","frames":2}],"frameSize":"4x4"},{"name":"coin","kind":"audio","subject":"coin"}]`

describe("Model Plus: spec → waiting stops the walk (2026-10-05)", () => {
  beforeEach(() => {
    singleCalls = 0
    capturedPrompts = []
    storedNames.clear()
    importGate = null
    for (const k of Object.keys(writes)) delete writes[k]
    useBlueprintsStore.setState({ logs: {}, blueprints: [bp()], running: {} })
  })
  it("the art director's contract is saved, the box waits (no running handle), the next AI is not started", async () => {
    reply = CONTRACT
    await useBlueprintsStore.getState().run("b1", "s")
    const st = useBlueprintsStore.getState()
    const m = st.byId("b1")!.nodes.find((n) => n.id === "m")!
    expect(m.status).toBe("waiting")
    expect(m.note).toContain("2 waiting")
    expect(m.data.type === "model" && m.data.requests.map((r) => r.name)).toEqual(["mario", "coin"])
    expect(m.data.type === "model" && m.data.tokens).toBe(11)
    expect(Object.keys(writes)).toContain(".silent/model-plus/requests.json")
    expect(JSON.parse(writes[".silent/model-plus/requests.json"]!).requests).toHaveLength(2)
    expect(st.byId("b1")!.nodes.find((n) => n.id === "next")!.status).toBeUndefined()
    expect(Object.keys(st.running)).toEqual([])
    // a second trigger does not ask the director again
    await useBlueprintsStore.getState().run("b1", "s")
    expect(singleCalls).toBe(1)
    expect(useBlueprintsStore.getState().byId("b1")!.nodes.find((n) => n.id === "m")!.status).toBe("waiting")
  })
  it("a reply without the heading fails the box with a readable note", async () => {
    reply = "I looked around but found nothing to request."
    await useBlueprintsStore.getState().run("b1", "s")
    const m = useBlueprintsStore.getState().byId("b1")!.nodes.find((n) => n.id === "m")!
    expect(m.status).toBe("failed")
    expect(m.note).toBe("no requests parsed")
  })
  it("a box whose requests are all accepted passes at once and the next AI runs with the manifest", async () => {
    const g = bp()
    g.nodes = g.nodes.map((n) => (n.id === "m" && n.data.type === "model" ? { ...n, data: { ...n.data, requests: [{ id: "mr_coin", name: "coin", kind: "audio", subject: "coin", sheetPrompt: "p", target: "assets/model-plus/coin", status: "accepted" }] } } : n))
    useBlueprintsStore.setState({ blueprints: [g] })
    await useBlueprintsStore.getState().run("b1", "s")
    const st = useBlueprintsStore.getState()
    const m = st.byId("b1")!.nodes.find((n) => n.id === "m")!
    expect(m.status).toBe("done")
    expect(m.data.type === "model" && m.data.report).toContain("# MODEL")
    expect(st.byId("b1")!.nodes.find((n) => n.id === "next")!.status).toBe("done")
    expect(singleCalls).toBe(1)
    expect(capturedPrompts[0]).toContain("# MODEL")
    expect(capturedPrompts[0]).toMatch(/do NOT redraw/)
  })
})

describe("Model Plus: deliver → convert → validate → resume (2026-10-05)", () => {
  const withContract = (): Blueprint => {
    const g = bp()
    g.nodes = g.nodes.map((n) => (n.id === "m" && n.data.type === "model" ? { ...n, status: "waiting" as const, data: { ...n.data, requests: [{ id: "mr_mario", name: "mario", kind: "sprite-sheet" as const, subject: "Mario", animations: [{ name: "walk", frames: 2 }], frameSize: "4x4", sheetPrompt: "p", target: "assets/model-plus/mario", status: "pending" as const }] } } : n))
    return g
  }
  beforeEach(() => {
    singleCalls = 0
    imports.length = 0
    converterPrompt = ""
    capturedPrompts = []
    storedNames.clear()
    importGate = null
    for (const k of Object.keys(writes)) delete writes[k]
    disk = ["assets/model-plus/mario/mario.png", "assets/model-plus/mario/mario.json", "assets/model-plus/mario/mario_walk_00.png", "assets/model-plus/mario/mario_walk_01.png"]
    atlasFrames = ["mario_walk_00", "mario_walk_01"]
    useBlueprintsStore.setState({ logs: {}, blueprints: [withContract()], running: {} })
  })
  it("a valid sheet is converted (tool brief), validated from disk, accepted; the manifest is written and the walk resumes", async () => {
    reply = "# MODEL_DELIVERY\n- assets/model-plus/mario/mario.png"
    const n = await useBlueprintsStore.getState().modelDeliver("b1", "m", ["/Users/x/Downloads/Mario-sheet.png"])
    expect(n).toBe(1)
    expect(imports[0]).toEqual({ folder: "/tmp/x/assets/model-plus/inbox", paths: ["/Users/x/Downloads/Mario-sheet.png"] })
    expect(converterPrompt).toContain("# MODEL_DELIVERY")
    expect(converterPrompt).toContain("- assets/model-plus/mario/mario.json")
    await new Promise((r) => setTimeout(r, 50))
    const st = useBlueprintsStore.getState()
    const m = st.byId("b1")!.nodes.find((x) => x.id === "m")!
    expect(m.data.type === "model" && m.data.requests[0]!.status).toBe("accepted")
    expect(m.status).toBe("done")
    expect(m.data.type === "model" && m.data.lastOk).toBe(true)
    expect(m.data.type === "model" && m.data.report).toContain("# MODEL\n- mario (sprite-sheet)")
    expect(writes["MODEL-PLUS.md"]).toContain("mario")
    expect(st.byId("b1")!.nodes.find((x) => x.id === "next")!.status).toBe("done")
    expect(m.data.type === "model" && m.data.requests[0]!.outputs).toContain("assets/model-plus/mario/mario.json")
  })
  it("M2: re-delivering the same file name converts the NEW (renamed) file", async () => {
    reply = "# MODEL_DELIVERY\n- x"
    atlasFrames = ["mario_walk_00"]
    disk = disk.filter((f) => !f.endsWith("mario_walk_01.png"))
    await useBlueprintsStore.getState().modelDeliver("b1", "m", ["/Users/x/mario.png"])
    const first = useBlueprintsStore.getState().byId("b1")!.nodes.find((x) => x.id === "m")!
    expect(first.data.type === "model" && first.data.requests[0]!.status).toBe("rejected")
    atlasFrames = ["mario_walk_00", "mario_walk_01"]
    disk.push("assets/model-plus/mario/mario_walk_01.png")
    await useBlueprintsStore.getState().modelDeliver("b1", "m", ["/Users/x/mario.png"])
    const m = useBlueprintsStore.getState().byId("b1")!.nodes.find((x) => x.id === "m")!
    const req = m.data.type === "model" ? m.data.requests[0]! : undefined
    expect(req?.delivered?.path).toBe("assets/model-plus/inbox/mario-2.png")
    expect(converterPrompt).toContain("assets/model-plus/inbox/mario-2.png")
    expect(req?.status).toBe("accepted")
  })
  it("M4: two deliveries in flight are serialised — neither is lost", async () => {
    reply = "# MODEL_DELIVERY\n- x"
    const g = bp()
    g.nodes = g.nodes.map((n) => (n.id === "m" && n.data.type === "model" ? { ...n, status: "waiting" as const, data: { ...n.data, requests: [
      { id: "mr_mario", name: "mario", kind: "sprite-sheet" as const, subject: "Mario", animations: [{ name: "walk", frames: 2 }], frameSize: "4x4", sheetPrompt: "p", target: "assets/model-plus/mario", status: "pending" as const },
      { id: "mr_coin", name: "coin", kind: "audio" as const, subject: "coin", sheetPrompt: "p", target: "assets/model-plus/coin", status: "pending" as const },
    ] } } : n))
    useBlueprintsStore.setState({ blueprints: [g] })
    disk.push("assets/model-plus/coin/coin.wav")
    let open!: () => void
    importGate = new Promise<void>((r) => { open = r })
    const a = useBlueprintsStore.getState().modelDeliver("b1", "m", ["/x/mario.png"])
    const b = useBlueprintsStore.getState().modelDeliver("b1", "m", ["/x/coin.wav"])
    await new Promise((r) => setTimeout(r, 10))
    open()
    await Promise.all([a, b])
    await new Promise((r) => setTimeout(r, 50))
    const m = useBlueprintsStore.getState().byId("b1")!.nodes.find((x) => x.id === "m")!
    const statuses = m.data.type === "model" ? m.data.requests.map((r) => [r.name, r.status]) : []
    expect(statuses).toEqual([["mario", "accepted"], ["coin", "accepted"]])
    expect(m.status).toBe("done")
  })
  it("M10: a validator crash rejects the request and releases the box", async () => {
    reply = "# MODEL_DELIVERY\n- x"
    atlasFrames = ["mario_walk_00", null as unknown as string]
    await useBlueprintsStore.getState().modelDeliver("b1", "m", ["/x/mario.png"])
    const m = useBlueprintsStore.getState().byId("b1")!.nodes.find((x) => x.id === "m")!
    const req = m.data.type === "model" ? m.data.requests[0]! : undefined
    expect(req?.status).toBe("rejected")
    expect(useBlueprintsStore.getState().running).toEqual({})
    expect(m.status).toBe("waiting")
  })
  it("M11: undo after a delivery does not revert the contract", async () => {
    reply = "# MODEL_DELIVERY\n- x"
    useBlueprintsStore.setState({ history: {}, future: {} })
    await useBlueprintsStore.getState().modelDeliver("b1", "m", ["/x/mario.png"])
    await new Promise((r) => setTimeout(r, 50))
    useBlueprintsStore.getState().undo("b1")
    const m = useBlueprintsStore.getState().byId("b1")!.nodes.find((x) => x.id === "m")!
    expect(m.data.type === "model" && m.data.requests[0]!.status).toBe("accepted")
  })
  it("M1: strict off + Continue resumes the chain with a partial contract", async () => {
    reply = "done"
    const g = bp()
    g.nodes = g.nodes.map((n) => (n.id === "m" && n.data.type === "model" ? { ...n, status: "waiting" as const, data: { ...n.data, strict: false, requests: [
      { id: "mr_coin", name: "coin", kind: "audio" as const, subject: "coin", sheetPrompt: "p", target: "assets/model-plus/coin", status: "accepted" as const, outputs: ["assets/model-plus/coin/coin.wav"] },
      { id: "mr_mario", name: "mario", kind: "sprite-sheet" as const, subject: "Mario", animations: [{ name: "walk", frames: 2 }], frameSize: "4x4", sheetPrompt: "p", target: "assets/model-plus/mario", status: "pending" as const },
    ] } } : n))
    useBlueprintsStore.setState({ blueprints: [g] })
    await useBlueprintsStore.getState().modelContinue("b1", "m")
    await new Promise((r) => setTimeout(r, 80))
    const st = useBlueprintsStore.getState()
    const m = st.byId("b1")!.nodes.find((x) => x.id === "m")!
    expect(m.status).toBe("done")
    expect(m.data.type === "model" && m.data.report).toContain("# UNRESOLVED\n- mario")
    expect(st.byId("b1")!.nodes.find((x) => x.id === "next")!.status).toBe("done")
    expect(capturedPrompts.some((p) => p.includes("# UNRESOLVED"))).toBe(true)
  })
  it("a short atlas is rejected with reasons; the box stays waiting and the next AI is untouched; force-accept resumes", async () => {
    atlasFrames = ["mario_walk_00"]
    disk = disk.filter((f) => !f.endsWith("mario_walk_01.png"))
    reply = "# MODEL_DELIVERY\n- partial"
    await useBlueprintsStore.getState().modelDeliver("b1", "m", ["/tmp/sheet.png"])
    const st = useBlueprintsStore.getState()
    const m = st.byId("b1")!.nodes.find((x) => x.id === "m")!
    const req = m.data.type === "model" ? m.data.requests[0]! : undefined
    expect(req?.status).toBe("rejected")
    expect(req?.reasons).toEqual(expect.arrayContaining(["missing: assets/model-plus/mario/mario_walk_01.png", "frames walk: 1/2 in the atlas"]))
    expect(m.status).toBe("waiting")
    expect(st.byId("b1")!.nodes.find((x) => x.id === "next")!.status).toBeUndefined()
    await useBlueprintsStore.getState().modelForceAccept("b1", "m", "mr_mario")
    await new Promise((r) => setTimeout(r, 50))
    const after = useBlueprintsStore.getState().byId("b1")!.nodes.find((x) => x.id === "m")!
    expect(after.status).toBe("done")
    expect(after.data.type === "model" && after.data.report).toContain("forced accept")
  })
})
