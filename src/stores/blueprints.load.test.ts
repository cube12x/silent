import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Blueprint } from "@/domain"
import { useBlueprintsStore } from "./blueprints"

let dbRows: Blueprint[] = []
const statsCalls: string[] = []
vi.mock("@/services", () => ({
  getBackend: async () => ({
    db: { blueprints: { list: async () => dbRows.map((b) => structuredClone(b)), upsert: async () => undefined } },
    listDir: async () => [],
    blueprintBuildStats: async (folder: string) => {
      statsCalls.push(folder)
      return { fileCount: 1, images: [], newestMs: 0 }
    },
  }),
}))

const bp = (status: "running" | "done", updatedAt: number): Blueprint => ({
  id: "b1",
  name: "T",
  nodes: [{ id: "a", type: "ai", x: 0, y: 0, status, data: { type: "ai", modelRef: "claude:sonnet", mode: "single" } }],
  edges: [],
  createdAt: 1,
  updatedAt,
})

describe("blueprints.load() while boxes run (2026-10-02)", () => {
  beforeEach(() => useBlueprintsStore.setState({ blueprints: [], logs: {}, running: {}, activeId: undefined }))
  it("the first load after a restart marks a running box without an executor as interrupted", async () => {
    dbRows = [bp("running", 10)]
    await useBlueprintsStore.getState().load()
    const n = useBlueprintsStore.getState().byId("b1")!.nodes[0]!
    expect(n.status).toBe("failed")
    expect(n.note).toBe("interrupted (app restarted)")
  })
  it("a later load (a `silent bp` trigger) keeps the newer in-memory state and never marks live boxes interrupted", async () => {
    dbRows = [bp("done", 10)]
    await useBlueprintsStore.getState().load()
    // A box finished a moment ago: memory is newer than the DB row whose upsert is still in flight.
    useBlueprintsStore.setState({ blueprints: [bp("done", 30)] })
    dbRows = [bp("running", 20)]
    await useBlueprintsStore.getState().load()
    const n = useBlueprintsStore.getState().byId("b1")!.nodes[0]!
    expect(n.status).toBe("done")
    expect(n.note).toBeUndefined()
  })
  it("a later load still picks up rows that are newer in the DB (written by a script)", async () => {
    dbRows = [bp("done", 10)]
    await useBlueprintsStore.getState().load()
    dbRows = [{ ...bp("done", 50), name: "renamed" }]
    await useBlueprintsStore.getState().load()
    expect(useBlueprintsStore.getState().byId("b1")!.name).toBe("renamed")
  })
})

describe("boot refreshes only the active blueprint's folders (2026-10-05 perf)", () => {
  it("other blueprints' Build boxes are not scanned until they become active", async () => {
    statsCalls.length = 0
    const withBuild = (id: string, folder: string): Blueprint => ({ id, name: id, nodes: [{ id: `${id}-b`, type: "build", x: 0, y: 0, data: { type: "build", title: "x", folderPath: folder, kind: "code", fileCount: 0 } }], edges: [], createdAt: 1, updatedAt: 1 })
    dbRows = [withBuild("b1", "/tmp/one"), withBuild("b2", "/tmp/two"), withBuild("b3", "/tmp/three")]
    useBlueprintsStore.setState({ blueprints: [], logs: {}, running: {}, activeId: "b1" })
    await useBlueprintsStore.getState().load()
    await new Promise((r) => setTimeout(r, 20))
    expect(statsCalls).toEqual(["/tmp/one"])
    useBlueprintsStore.getState().setActive("b3")
    await new Promise((r) => setTimeout(r, 20))
    expect(statsCalls).toEqual(["/tmp/one", "/tmp/three"])
  })
})
