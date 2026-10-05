import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Blueprint } from "@/domain"
import { useBlueprintsStore } from "./blueprints"

let laneText: Record<string, string> = {}
vi.mock("@/services", () => ({
  getBackend: async () => ({
    db: { blueprints: { upsert: async () => undefined } },
    projectSweep: async () => 0,
    cliStart: async () => { throw new Error("no cli in this test") },
  }),
}))
const laneCalls: string[] = []
vi.mock("@/engine/blueprint/single", () => ({
  runSingle: (_backend: unknown, req: { prompt: string }) => {
    const lane = Object.keys(laneText).find((l) => req.prompt.includes(`LANE: ${l}`)) ?? ""
    laneCalls.push(lane)
    return { cancel: async () => undefined, done: Promise.resolve({ ok: true, text: laneText[lane] ?? "", tokens: 1, sessionId: "s" }) }
  },
}))

const bp = (): Blueprint => ({
  id: "b1",
  name: "T",
  nodes: [
    { id: "s", type: "button", x: 0, y: 0, data: { type: "button", kind: "start" } },
    { id: "b", type: "build", x: 0, y: 0, data: { type: "build", title: "x", folderPath: "/tmp/x", kind: "code" } },
    { id: "v", type: "verify", x: 0, y: 0, data: { type: "verify", title: "Çoklu Tarayıcı", modelRef: "claude:sonnet", lanes: ["play", "swim"] } },
    { id: "fix", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "", mode: "single", role: "eylem" } },
  ],
  edges: [{ id: "e1", from: "s", to: "b" }, { id: "e2", from: "b", to: "v" }, { id: "e3", from: "v", to: "fix" }],
  createdAt: 1,
  updatedAt: 1,
})

describe("Çoklu Tarayıcı → fixer hand-off (2026-10-03)", () => {
  beforeEach(() => useBlueprintsStore.setState({ logs: {}, blueprints: [bp()], running: {} }))
  it("a lane with findings marks the box red (lastOk false) so the wired Eylem gets the report as its work order", async () => {
    laneText = { play: "# VERIFY\n- OK", swim: "# VERIFY\n- [high] the air bar never hides after leaving the water" }
    await useBlueprintsStore.getState().run("b1", "s")
    const st = useBlueprintsStore.getState()
    const v = st.byId("b1")!.nodes.find((n) => n.id === "v")!
    expect(v.data.type === "verify" && v.data.lastOk).toBe(false)
    expect(v.data.type === "verify" && v.data.failedLanes).toEqual(["swim"])
    const fix = st.byId("b1")!.nodes.find((n) => n.id === "fix")!
    expect(fix.status).toBeDefined() // the fixer was started (it fails here only because the test has no model)
    expect(fix.note).not.toBe("no prompt")
  })
  it("inconclusive lanes skip the fixer but the chain walks on to the next (non-Eylem) box", async () => {
    const g = bp()
    g.nodes.push({ id: "next", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "", mode: "single", title: "Next" } })
    g.edges.push({ id: "e4", from: "v", to: "next" })
    useBlueprintsStore.setState({ blueprints: [g] })
    laneText = { play: "# VERIFY\n- OK", swim: "# VERIFY\n- INCONCLUSIVE: the machine is overloaded" }
    await useBlueprintsStore.getState().run("b1", "s")
    const st = useBlueprintsStore.getState()
    const v = st.byId("b1")!.nodes.find((n) => n.id === "v")!
    expect(v.note).toContain("inconclusive")
    expect(v.data.type === "verify" && v.data.failedLanes).toEqual(["swim"])
    expect(st.byId("b1")!.nodes.find((n) => n.id === "fix")!.status).toBeUndefined()
    expect(st.byId("b1")!.nodes.find((n) => n.id === "next")!.status).toBeDefined()
  })
  it("a critically loaded host skips the lanes entirely (inconclusive, no browser, no fixer) and the chain goes on", async () => {
    const { useHostStore } = await import("./host")
    useHostStore.setState({ level: "critical" })
    const g = bp()
    g.nodes.push({ id: "next", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "", mode: "single", title: "Next" } })
    g.edges.push({ id: "e4", from: "v", to: "next" })
    useBlueprintsStore.setState({ blueprints: [g] })
    laneText = { play: "# VERIFY\n- [high] should never run", swim: "# VERIFY\n- [high] should never run" }
    await useBlueprintsStore.getState().run("b1", "s")
    const st = useBlueprintsStore.getState()
    const v = st.byId("b1")!.nodes.find((n) => n.id === "v")!
    expect(v.note).toMatch(/host|yük|busy/i)
    expect(v.data.type === "verify" && v.data.failedLanes).toEqual(["play", "swim"])
    expect(st.byId("b1")!.nodes.find((n) => n.id === "fix")!.status).toBeUndefined()
    expect(st.byId("b1")!.nodes.find((n) => n.id === "next")!.status).toBeDefined()
    useHostStore.setState({ level: "ok" })
  })
})

describe("browser lanes give up fast (2026-10-05 time-waste hunt)", () => {
  it("the first lane that cannot be driven stops the remaining lanes", async () => {
    const { useHostStore } = await import("./host")
    useHostStore.setState({ level: "ok" })
    const g = bp()
    g.nodes = g.nodes.map((n) => (n.id === "v" && n.data.type === "verify" ? { ...n, data: { ...n.data, lanes: ["play", "swim", "fly"] } } : n))
    useBlueprintsStore.setState({ logs: {}, blueprints: [g], running: {} })
    laneText = { play: "# VERIFY\n- INCONCLUSIVE: the machine is overloaded", swim: "# VERIFY\n- OK", fly: "# VERIFY\n- OK" }
    laneCalls.length = 0
    useHostStore.setState({ cap: () => 1 } as never)
    await useBlueprintsStore.getState().run("b1", "s")
    expect(laneCalls).toEqual(["play"])
    const v = useBlueprintsStore.getState().byId("b1")!.nodes.find((n) => n.id === "v")!
    expect(v.note).toMatch(/3\/3 lanes inconclusive/)
    expect(v.data.type === "verify" && v.data.failedLanes).toEqual(["play", "swim", "fly"])
  })
  it("a busy (high) host skips the lanes before any browser starts", async () => {
    const { useHostStore } = await import("./host")
    useHostStore.setState({ level: "high" })
    useBlueprintsStore.setState({ logs: {}, blueprints: [bp()], running: {} })
    laneCalls.length = 0
    laneText = { play: "# VERIFY\n- OK", swim: "# VERIFY\n- OK" }
    await useBlueprintsStore.getState().run("b1", "s")
    expect(laneCalls).toEqual([])
    useHostStore.setState({ level: "ok" })
  })
})
