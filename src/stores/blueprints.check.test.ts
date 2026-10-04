import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Blueprint } from "@/domain"
import { useBlueprintsStore } from "./blueprints"

const calls: string[] = []
let results: Array<{ ok: boolean; tail: string }> = []
vi.mock("@/services", () => ({
  getBackend: async () => ({
    db: { blueprints: { upsert: async () => undefined } },
    runCheck: async (_cwd: string, command: string) => {
      calls.push(command)
      const r = results.shift() ?? { ok: true, tail: "" }
      return { ok: r.ok, exitCode: r.ok ? 0 : 1, tail: r.tail, elapsedMs: 1 }
    },
  }),
}))

const bp = (): Blueprint => ({
  id: "b1",
  name: "T",
  nodes: [
    { id: "s", type: "button", x: 0, y: 0, data: { type: "button", kind: "start" } },
    { id: "b", type: "build", x: 0, y: 0, data: { type: "build", title: "x", folderPath: "/tmp/x", kind: "code" } },
    { id: "chk", type: "check", x: 0, y: 0, data: { type: "check", commands: ["npm test"], maxLines: 40, timeoutSecs: 60 } },
    { id: "fix", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "", mode: "single", role: "eylem" } },
  ],
  edges: [{ id: "e1", from: "s", to: "b" }, { id: "e2", from: "b", to: "chk" }, { id: "e3", from: "chk", to: "fix" }],
  createdAt: 1,
  updatedAt: 1,
})

describe("Denetçi self-healing (2026-10-01)", () => {
  beforeEach(() => {
    calls.length = 0
    useBlueprintsStore.setState({ logs: {}, blueprints: [bp()], running: {} })
  })
  it("a red check runs its fixer and checks once more; green on the second pass keeps the chain alive", async () => {
    results = [{ ok: false, tail: "1 failed" }, { ok: true, tail: "" }]
    await useBlueprintsStore.getState().run("b1", "s")
    expect(calls).toEqual(["npm test", "npm test"])
    const chk = useBlueprintsStore.getState().byId("b1")!.nodes.find((n) => n.id === "chk")!
    expect(chk.status).toBe("done")
    expect(chk.data.type === "check" && chk.data.lastOk).toBe(true)
  })
  it("a check that stays red after the fixer stops the chain", async () => {
    results = [{ ok: false, tail: "boom" }, { ok: false, tail: "boom" }]
    await useBlueprintsStore.getState().run("b1", "s")
    expect(calls).toHaveLength(2)
    const chk = useBlueprintsStore.getState().byId("b1")!.nodes.find((n) => n.id === "chk")!
    expect(chk.status).toBe("failed")
  })
})

describe("soft commands and continuation (2026-10-04)", () => {
  const withSoft = (): Blueprint => {
    const g = bp()
    g.nodes = g.nodes.map((n) => (n.id === "chk" ? { ...n, data: { type: "check", commands: ["npm test"], softCommands: ["npm run e2e"], maxLines: 40, timeoutSecs: 60 } } : n))
    g.nodes.push({ id: "next", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "", mode: "single", title: "Next" } })
    g.edges.push({ id: "e4", from: "chk", to: "next" })
    return g
  }
  beforeEach(() => {
    calls.length = 0
    useBlueprintsStore.setState({ logs: {}, blueprints: [withSoft()], running: {} })
  })
  it("a red SOFT command is a warning: no fixer, lastOk stays true, the chain walks on to the next AI", async () => {
    results = [{ ok: true, tail: "" }, { ok: false, tail: "1 failed" }]
    await useBlueprintsStore.getState().run("b1", "s")
    expect(calls).toEqual(["npm test", "npm run e2e"])
    const st = useBlueprintsStore.getState()
    const chk = st.byId("b1")!.nodes.find((n) => n.id === "chk")!
    expect(chk.status).toBe("done")
    expect(chk.note ?? "").toMatch(/soft|warn/i)
    expect(chk.data.type === "check" && chk.data.lastOk).toBe(true)
    expect(chk.data.type === "check" && chk.data.report).toContain("npm run e2e: FAIL")
    expect(st.byId("b1")!.nodes.find((n) => n.id === "fix")!.status).toBeUndefined()
    expect(st.byId("b1")!.nodes.find((n) => n.id === "next")!.status).toBeDefined()
  })
  it("a red BLOCKING command still stops before the next AI (fixer runs, re-check, stop)", async () => {
    results = [{ ok: false, tail: "boom" }, { ok: false, tail: "boom" }]
    await useBlueprintsStore.getState().run("b1", "s")
    const st = useBlueprintsStore.getState()
    expect(st.byId("b1")!.nodes.find((n) => n.id === "next")!.status).toBeUndefined()
  })
  it("continueOnFail: the chain walks on even after a red check", async () => {
    const g = withSoft()
    g.nodes = g.nodes.map((n) => (n.id === "chk" && n.data.type === "check" ? { ...n, data: { ...n.data, continueOnFail: true } } : n))
    useBlueprintsStore.setState({ blueprints: [g] })
    results = [{ ok: false, tail: "boom" }, { ok: false, tail: "boom" }]
    await useBlueprintsStore.getState().run("b1", "s")
    expect(useBlueprintsStore.getState().byId("b1")!.nodes.find((n) => n.id === "next")!.status).toBeDefined()
  })
})
