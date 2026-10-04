import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Blueprint } from "@/domain"
import { useBlueprintsStore } from "./blueprints"

let stats = { fileCount: 5, images: [] as string[], newestMs: 0 }
vi.mock("@/services", () => ({
  getBackend: async () => ({
    db: { blueprints: { upsert: async () => undefined } },
    blueprintBuildStats: async () => stats,
  }),
}))

const bp = (): Blueprint => ({
  id: "b1",
  name: "T",
  nodes: [{ id: "b", type: "build", x: 0, y: 0, data: { type: "build", title: "x", folderPath: "/tmp/x", kind: "code", fileCount: 1 } }],
  edges: [],
  createdAt: 1,
  updatedAt: 1000,
})

describe("derived refreshes do not count as edits (2026-10-04: every boot bumped updatedAt of 5 blueprints, so `silent status` could not tell old blueprints from fresh ones)", () => {
  beforeEach(() => useBlueprintsStore.setState({ blueprints: [bp()], history: {}, future: {} }))
  it("refreshBuild stores the new file count but keeps updatedAt and adds no history", async () => {
    stats = { fileCount: 5, images: [], newestMs: 0 }
    await useBlueprintsStore.getState().refreshBuild("b1", "b")
    const b = useBlueprintsStore.getState().byId("b1")!
    expect(b.nodes[0]!.data.type === "build" && b.nodes[0]!.data.fileCount).toBe(5)
    expect(b.updatedAt).toBe(1000)
    expect(useBlueprintsStore.getState().history["b1"] ?? []).toHaveLength(0)
  })
  it("a real edit still bumps updatedAt", () => {
    useBlueprintsStore.getState().updateNode("b1", "b", { x: 10 })
    expect(useBlueprintsStore.getState().byId("b1")!.updatedAt).toBeGreaterThan(1000)
  })
})
