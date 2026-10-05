import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Blueprint } from "@/domain"
import { useBlueprintsStore } from "./blueprints"

const calls: string[] = []
const timeouts: number[] = []
let results: Array<{ ok: boolean; tail: string }> = []
vi.mock("@/services", () => ({
  getBackend: async () => ({
    db: { blueprints: { upsert: async () => undefined } },
    runCheck: async (_cwd: string, command: string, timeoutSecs?: number) => {
      calls.push(command)
      timeouts.push(timeoutSecs ?? 0)
      const r = results.shift() ?? { ok: true, tail: "" }
      const timedOut = r.tail.startsWith("timed out")
      return { ok: r.ok, exitCode: r.ok ? 0 : timedOut ? null : 1, tail: r.tail, elapsedMs: 1 }
    },
    checkCancel: async () => undefined,
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

describe("soft e2e that keeps timing out is skipped (2026-10-05 time-waste hunt)", () => {
  const withSoft = (streak?: Record<string, number>): Blueprint => {
    const g = bp()
    g.nodes = g.nodes.map((n) => (n.id === "chk" ? { ...n, data: { type: "check", commands: ["npm test"], softCommands: ["npm run e2e"], maxLines: 40, timeoutSecs: 2400, softTimeouts: streak } } : n))
    return g
  }
  beforeEach(() => {
    calls.length = 0
    timeouts.length = 0
  })
  it("soft commands get 10 min even when the box allows 40", async () => {
    useBlueprintsStore.setState({ logs: {}, blueprints: [withSoft()], running: {} })
    results = [{ ok: true, tail: "" }, { ok: true, tail: "" }]
    await useBlueprintsStore.getState().run("b1", "s")
    expect(calls).toEqual(["npm test", "npm run e2e"])
    expect(timeouts[1]).toBe(600)
  })
  it("two time-outs in a row → the third run skips it; a pass resets the streak", async () => {
    useBlueprintsStore.setState({ logs: {}, blueprints: [withSoft()], running: {} })
    results = [{ ok: true, tail: "" }, { ok: false, tail: "timed out after 600 s" }]
    await useBlueprintsStore.getState().run("b1", "s")
    results = [{ ok: true, tail: "" }, { ok: false, tail: "timed out after 600 s" }]
    await useBlueprintsStore.getState().run("b1", "s")
    let chk = useBlueprintsStore.getState().byId("b1")!.nodes.find((n) => n.id === "chk")!
    expect(chk.data.type === "check" && chk.data.softTimeouts).toEqual({ "npm run e2e": 2 })
    calls.length = 0
    results = [{ ok: true, tail: "" }]
    await useBlueprintsStore.getState().run("b1", "s")
    expect(calls).toEqual(["npm test"])
    chk = useBlueprintsStore.getState().byId("b1")!.nodes.find((n) => n.id === "chk")!
    expect(chk.data.type === "check" && chk.data.report).toContain("npm run e2e: skipped (timed out on the last 2 runs")
    // a green soft run resets the streak
    useBlueprintsStore.setState({ blueprints: [withSoft({ "npm run e2e": 1 })] })
    results = [{ ok: true, tail: "" }, { ok: true, tail: "" }]
    await useBlueprintsStore.getState().run("b1", "s")
    chk = useBlueprintsStore.getState().byId("b1")!.nodes.find((n) => n.id === "chk")!
    expect(chk.data.type === "check" && chk.data.softTimeouts).toEqual({ "npm run e2e": 0 })
  })
})
