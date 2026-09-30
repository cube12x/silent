import { describe, expect, it } from "vitest"
import type { Blueprint } from "@/domain"
import { graphJson } from "./blueprintJson"

describe("blueprint graph_json", () => {
  it("round-trips nodes, edges, viewport and meta (the Tamirci preset lives in meta)", () => {
    const bp: Blueprint = { id: "b", name: "n", createdAt: 1, updatedAt: 2, nodes: [], edges: [], viewport: { x: 1, y: 2, zoom: 1 }, meta: { tamirci: { modelRef: "claude:opus", instructions: "be careful" } } }
    const back = JSON.parse(graphJson(bp)) as Partial<Blueprint>
    expect(back.meta?.tamirci?.modelRef).toBe("claude:opus")
    expect(back.viewport).toEqual({ x: 1, y: 2, zoom: 1 })
    expect("id" in back).toBe(false)
  })
})
