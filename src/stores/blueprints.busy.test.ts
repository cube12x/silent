import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Blueprint } from "@/domain"
import { useBlueprintsStore } from "./blueprints"

const calls: string[] = []
vi.mock("@/services", () => ({
  getBackend: async () => ({
    db: { blueprints: { upsert: async () => undefined } },
    runCheck: async (_cwd: string, command: string) => {
      calls.push(command)
      return { ok: true, exitCode: 0, tail: "", elapsedMs: 1 }
    },
  }),
}))

// s → b → chk → next : `next` is already running as part of another chain (e.g. the previous stage's fixer on the hub).
const bp = (): Blueprint => ({
  id: "b1",
  name: "T",
  nodes: [
    { id: "s", type: "button", x: 0, y: 0, data: { type: "button", kind: "start" } },
    { id: "b", type: "build", x: 0, y: 0, data: { type: "build", title: "x", folderPath: "/tmp/x", kind: "code" } },
    { id: "chk", type: "check", x: 0, y: 0, data: { type: "check", commands: ["npm test"], maxLines: 40, timeoutSecs: 60 } },
    { id: "next", type: "ai", x: 0, y: 0, status: "running", data: { type: "ai", modelRef: "", mode: "single", title: "Next" } },
  ],
  edges: [{ id: "e1", from: "s", to: "b" }, { id: "e2", from: "b", to: "chk" }, { id: "e3", from: "chk", to: "next" }],
  createdAt: 1,
  updatedAt: 1,
})

const allLogs = () => Object.values(useBlueprintsStore.getState().logs).flat().map((l) => l.text).join("\n")

describe("a busy box downstream no longer refuses the whole trigger (2026-10-04: 4B could not start while a Tamirci ran on the hub)", () => {
  beforeEach(() => {
    calls.length = 0
    useBlueprintsStore.setState({ logs: {}, blueprints: [bp()], running: {} })
  })
  it("the trigger is refused only when the FIRST box of the walk is the busy one", async () => {
    useBlueprintsStore.setState({ running: { chk: async () => undefined } })
    const g = bp()
    g.nodes = g.nodes.map((n) => (n.id === "chk" ? { ...n, status: "running" } : n))
    useBlueprintsStore.setState({ blueprints: [g] })
    await useBlueprintsStore.getState().run("b1", "s")
    expect(calls).toEqual([])
    await new Promise((r) => setTimeout(r, 400))
    expect(allLogs()).toMatch(/already running/)
  })
  it("a busy box later in the walk is awaited, then skipped when it ends green; the steps before it run at once", async () => {
    useBlueprintsStore.setState({ running: { next: async () => undefined } })
    const done = useBlueprintsStore.getState().run("b1", "s")
    await new Promise((r) => setTimeout(r, 50))
    expect(calls).toEqual(["npm test"])
    // the other chain finishes the box
    useBlueprintsStore.getState().updateNode("b1", "next", { status: "done" })
    useBlueprintsStore.setState({ running: {} })
    await done
    const next = useBlueprintsStore.getState().byId("b1")!.nodes.find((n) => n.id === "next")!
    expect(next.status).toBe("done") // not re-run (a re-run with modelRef "" would mark it failed / "no model")
    await new Promise((r) => setTimeout(r, 400))
    expect(allLogs()).toMatch(/waiting/i)
  })
})
