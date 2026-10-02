import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Blueprint } from "@/domain"
import { useBlueprintsStore } from "./blueprints"

vi.mock("@/services", () => ({
  getBackend: async () => ({ db: { blueprints: { upsert: async () => undefined } } }),
}))

const bp = (id: string): Blueprint => ({
  id,
  name: id,
  nodes: [
    { id: `${id}-a`, type: "ai", x: 0, y: 0, status: "running", data: { type: "ai", modelRef: "claude:sonnet", mode: "single" } },
    { id: `${id}-b`, type: "ai", x: 0, y: 0, status: "idle", data: { type: "ai", modelRef: "claude:sonnet", mode: "single" } },
  ],
  edges: [],
  createdAt: 1,
  updatedAt: 1,
})

describe("`silent cancel` (2026-10-02): stop every running blueprint box", () => {
  beforeEach(() => useBlueprintsStore.setState({ logs: {}, blueprints: [bp("x"), bp("y")], running: {} }))
  it("calls every stop handle, marks the boxes cancelled and returns the count", async () => {
    const stopped: string[] = []
    useBlueprintsStore.setState({ running: { "x-a": async () => void stopped.push("x-a"), "y-a": () => void stopped.push("y-a") } })
    const n = await useBlueprintsStore.getState().cancelAll()
    expect(n).toBe(2)
    expect(stopped.sort()).toEqual(["x-a", "y-a"])
    const st = useBlueprintsStore.getState()
    expect(st.byId("x")?.nodes[0]?.status).toBe("failed")
    expect(st.byId("x")?.nodes[0]?.note).toBe("cancelled")
    expect(st.byId("y")?.nodes[1]?.status).toBe("idle")
  })
  it("is a no-op when nothing runs", async () => {
    expect(await useBlueprintsStore.getState().cancelAll()).toBe(0)
  })
})
