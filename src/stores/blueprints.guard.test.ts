import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Blueprint } from "@/domain"
import { useBlueprintsStore } from "./blueprints"
import { useRunsStore } from "./runs"

let checkDelayMs = 0
let checkResults: Array<{ ok: boolean; tail: string }> = []
const cancels: string[] = []
let singleCalls = 0
let writeToolGate: Promise<void> = Promise.resolve()
vi.mock("@/services", () => ({
  getBackend: async () => ({
    db: { blueprints: { upsert: async () => undefined }, runs: { upsert: async () => undefined } },
    projectSweep: async () => 0,
    repoDigest: async () => "",
    readProjectFile: async () => null,
    writeProjectFile: async () => undefined,
    listProjectFiles: async () => [],
    blueprintBuildDir: async () => "/tmp/x",
    blueprintBuildStats: async () => ({ fileCount: 0, images: [], newestMs: 0 }),
    blueprintWriteTool: async () => { await writeToolGate; return "" },
    runCheck: async (_cwd: string, command: string) => {
      if (checkDelayMs) await new Promise((r) => setTimeout(r, checkDelayMs))
      const r = checkResults.shift() ?? { ok: true, tail: "" }
      return { ok: r.ok, exitCode: r.ok ? 0 : 1, tail: r.tail, elapsedMs: 1, command }
    },
    checkCancel: async (token: string) => { cancels.push(token) },
    cliStart: async () => { throw new Error("no cli in this test") },
  }),
}))
vi.mock("@/engine/blueprint/single", () => ({
  runSingle: () => {
    singleCalls += 1
    return { cancel: async () => undefined, done: new Promise((resolve) => setTimeout(() => resolve({ ok: true, text: "done", tokens: 1, sessionId: "s" }), 30)) }
  },
}))

const base = (): Blueprint => ({
  id: "b1",
  name: "T",
  nodes: [
    { id: "s", type: "button", x: 0, y: 0, data: { type: "button", kind: "start" } },
    { id: "b", type: "build", x: 0, y: 0, data: { type: "build", title: "x", folderPath: "/tmp/x", kind: "code" } },
    { id: "chk", type: "check", x: 0, y: 0, data: { type: "check", commands: ["npm test"], maxLines: 40, timeoutSecs: 60 } },
    { id: "fix", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", role: "eylem", title: "Eylem" } },
    { id: "next", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", title: "Next" } },
    { id: "pn", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "Next task", text: "continue the work" } },
  ],
  edges: [{ id: "e1", from: "s", to: "b" }, { id: "e2", from: "b", to: "chk" }, { id: "e3", from: "chk", to: "fix" }, { id: "e4", from: "chk", to: "next" }, { id: "e6", from: "pn", to: "next" }],
  createdAt: 1,
  updatedAt: 1,
})
const node = (id: string) => useBlueprintsStore.getState().byId("b1")!.nodes.find((n) => n.id === id)!
const logsOf = (id: string) => (useBlueprintsStore.getState().logs[id] ?? []).map((l) => l.text).join("\n")

describe("running handles never leak (2026-10-05 bug hunt E1)", () => {
  beforeEach(() => {
    checkDelayMs = 0
    checkResults = []
    cancels.length = 0
    singleCalls = 0
    writeToolGate = Promise.resolve()
    useBlueprintsStore.setState({ logs: {}, blueprints: [base()], running: {} })
  })
  it("a planner failure releases the orchestration box", async () => {
    const g = base()
    g.nodes = g.nodes.map((n) => (n.id === "next" ? { ...n, data: { ...n.data, mode: "orchestration" as const } } : n))
    g.edges = [{ id: "e1", from: "s", to: "b" }, { id: "e5", from: "b", to: "next" }, { id: "e6", from: "pn", to: "next" }]
    useBlueprintsStore.setState({ blueprints: [g] })
    useRunsStore.setState({ plan: async () => ({ source: "heuristic", error: "no model" }) } as never)
    await useBlueprintsStore.getState().run("b1", "s")
    expect(node("next").status).toBe("failed")
    expect(useBlueprintsStore.getState().running).toEqual({})
  })
  it("cancel releases a box even when its executor never does", async () => {
    useBlueprintsStore.setState({ running: { next: async () => undefined } })
    await useBlueprintsStore.getState().cancel("b1", "next")
    expect(useBlueprintsStore.getState().running).toEqual({})
    expect(node("next").note).toBe("cancelled")
  })
})

describe("cancelled checks, fixer re-entry, early reservation, continueOnFail (E2–E5)", () => {
  beforeEach(() => {
    checkDelayMs = 0
    checkResults = []
    cancels.length = 0
    singleCalls = 0
    writeToolGate = Promise.resolve()
    useBlueprintsStore.setState({ logs: {}, blueprints: [base()], running: {} })
  })
  it("E2: cancelling a running Denetçi kills its command and starts no fixer", async () => {
    checkDelayMs = 80
    checkResults = [{ ok: false, tail: "would be red" }]
    const walk = useBlueprintsStore.getState().run("b1", "s")
    await new Promise((r) => setTimeout(r, 20))
    await useBlueprintsStore.getState().cancel("b1", "chk")
    await walk
    expect(cancels).toHaveLength(1)
    expect(cancels[0]).toMatch(/^bp:check:chk:/)
    expect(node("fix").status).toBeUndefined()
    expect(node("next").status).toBeUndefined()
    expect(singleCalls).toBe(0)
    expect(node("chk").note).toBe("cancelled")
  })
  it("E3: a fixer another chain is running is awaited, not started a second time", async () => {
    checkResults = [{ ok: false, tail: "red" }, { ok: true, tail: "" }]
    useBlueprintsStore.setState({ running: { fix: async () => undefined } })
    const walk = useBlueprintsStore.getState().run("b1", "s")
    await new Promise((r) => setTimeout(r, 40))
    expect(singleCalls).toBe(0) // not re-entered while busy
    useBlueprintsStore.getState().updateNode("b1", "fix", { status: "done" })
    useBlueprintsStore.setState({ running: {} })
    await walk
    expect(singleCalls).toBe(1) // only `next`
    expect(node("chk").status).toBe("done")
  })
  it("E4: the box is reserved before the first await, so a second trigger in that window is refused", async () => {
    let open!: () => void
    writeToolGate = new Promise<void>((r) => { open = r })
    const g = base()
    g.edges = [{ id: "e1", from: "s", to: "b" }, { id: "e5", from: "b", to: "next" }, { id: "e6", from: "pn", to: "next" }]
    useBlueprintsStore.setState({ blueprints: [g] })
    const first = useBlueprintsStore.getState().run("b1", "next")
    const second = useBlueprintsStore.getState().run("b1", "next")
    await new Promise((r) => setTimeout(r, 10))
    expect(useBlueprintsStore.getState().running["next"]).toBeDefined()
    open()
    await Promise.all([first, second])
    expect(singleCalls).toBe(1)
    expect(logsOf("next")).toMatch(/already running/)
  })
  it("E5: continueOnFail walks on even when the red check has no fixer wired", async () => {
    const g = base()
    g.nodes = g.nodes.filter((n) => n.id !== "fix").map((n) => (n.id === "chk" && n.data.type === "check" ? { ...n, data: { ...n.data, continueOnFail: true } } : n))
    g.edges = g.edges.filter((e) => e.to !== "fix")
    useBlueprintsStore.setState({ blueprints: [g] })
    checkResults = [{ ok: false, tail: "red" }]
    await useBlueprintsStore.getState().run("b1", "s")
    expect(node("chk").status).toBe("failed")
    expect(node("next").status).toBe("done")
  })
})

describe("a waiting Model Plus box stops only its own branch (M3)", () => {
  it("sibling branches keep walking; the integration AI behind the box does not start", async () => {
    const g: Blueprint = {
      id: "b1",
      name: "T",
      nodes: [
        { id: "s", type: "button", x: 0, y: 0, data: { type: "button", kind: "start" } },
        { id: "b", type: "build", x: 0, y: 0, data: { type: "build", title: "x", folderPath: "/tmp/x", kind: "code" } },
        { id: "m", type: "model", x: 0, y: 0, status: "waiting", data: { type: "model", modelRef: "claude:sonnet", folder: "assets/model-plus", requests: [{ id: "mr_a", name: "a", kind: "image", subject: "a", sheetPrompt: "p", target: "assets/model-plus/a", status: "pending" }] } },
        { id: "integ", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", title: "Integ" } },
        { id: "p", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "Gameplay", text: "do gameplay" } },
        { id: "sib", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", title: "Sibling" } },
      ],
      edges: [{ id: "e1", from: "s", to: "b" }, { id: "e2", from: "b", to: "m" }, { id: "e3", from: "m", to: "integ" }, { id: "e4", from: "b", to: "p" }, { id: "e5", from: "p", to: "sib" }],
      createdAt: 1,
      updatedAt: 1,
    }
    singleCalls = 0
    useBlueprintsStore.setState({ logs: {}, blueprints: [g], running: {} })
    await useBlueprintsStore.getState().run("b1", "s")
    expect(node("m").status).toBe("waiting")
    expect(node("integ").status).toBeUndefined()
    expect(node("sib").status).toBe("done")
  })
})
