import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Blueprint } from "@/domain"
import { useBlueprintsStore } from "./blueprints"

vi.mock("@/services", () => ({ getBackend: async () => ({ db: { blueprints: { upsert: async () => undefined } } }) }))

const bp = (): Blueprint => ({ id: "b1", name: "T", nodes: [], edges: [], createdAt: 1, updatedAt: 1 })

describe("blueprint undo/redo", () => {
  beforeEach(() => useBlueprintsStore.setState({ blueprints: [bp()], history: {}, future: {} }))
  it("undoes graph edits, skips run-state changes, and redoes", () => {
    const st = useBlueprintsStore.getState()
    const n = st.addNode("b1", "prompt", 10, 10, { title: "A", text: "" })!
    vi.setSystemTime(Date.now() + 2000)
    st.updateNode("b1", n.id, { data: { title: "B" } })
    st.updateNode("b1", n.id, { status: "running" })
    expect(useBlueprintsStore.getState().history.b1).toHaveLength(2)
    st.undo("b1")
    let node = useBlueprintsStore.getState().byId("b1")!.nodes[0]
    expect(node.data.type === "prompt" && node.data.title).toBe("A")
    st.undo("b1")
    expect(useBlueprintsStore.getState().byId("b1")!.nodes).toHaveLength(0)
    st.redo("b1")
    st.redo("b1")
    node = useBlueprintsStore.getState().byId("b1")!.nodes[0]
    expect(node.data.type === "prompt" && node.data.title).toBe("B")
    expect(useBlueprintsStore.getState().future.b1).toHaveLength(0)
  })
})
