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
vi.mock("@/engine/blueprint/single", () => ({
  runSingle: (_backend: unknown, req: { prompt: string }) => {
    const lane = Object.keys(laneText).find((l) => req.prompt.includes(`LANE: ${l}`)) ?? ""
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
  it("inconclusive lanes stop the chain without touching the fixer", async () => {
    laneText = { play: "# VERIFY\n- OK", swim: "# VERIFY\n- INCONCLUSIVE: the machine is overloaded" }
    await useBlueprintsStore.getState().run("b1", "s")
    const st = useBlueprintsStore.getState()
    const v = st.byId("b1")!.nodes.find((n) => n.id === "v")!
    expect(v.note).toContain("inconclusive")
    expect(v.data.type === "verify" && v.data.failedLanes).toEqual(["swim"])
    expect(st.byId("b1")!.nodes.find((n) => n.id === "fix")!.status).toBeUndefined()
  })
})
