import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Blueprint } from "@/domain"
import { flushNodeLogs, useBlueprintsStore } from "./blueprints"

vi.mock("@/services", () => ({ getBackend: async () => ({ db: { blueprints: { upsert: async () => undefined } } }) }))

const bp = (): Blueprint => ({ id: "b1", name: "T", nodes: [{ id: "n1", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "", text: "" } }], edges: [], createdAt: 1, updatedAt: 1 })

describe("blueprint node logs", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useBlueprintsStore.setState({ logs: {}, blueprints: [bp()], running: {} })
  })
  it("keeps the stream of every line and publishes in one batch", async () => {
    // run() on a prompt with nothing wired forward writes one system line through the internal log()
    await useBlueprintsStore.getState().run("b1", "n1")
    expect(useBlueprintsStore.getState().logs.n1).toBeUndefined()
    vi.advanceTimersByTime(120)
    const lines = useBlueprintsStore.getState().logs.n1 ?? []
    expect(lines.length).toBe(1)
    expect(lines[0]).toMatchObject({ stream: "system" })
    expect(lines[0].text).toMatch(/no AI wired/)
    expect(typeof lines[0].ts).toBe("number")
  })
  it("caps a node at 1500 lines, newest kept", async () => {
    useBlueprintsStore.setState({ logs: { n1: Array.from({ length: 1499 }, (_, i) => ({ ts: i, stream: "stdout" as const, text: `l${i}` })) } })
    await useBlueprintsStore.getState().run("b1", "n1")
    await useBlueprintsStore.getState().run("b1", "n1")
    flushNodeLogs()
    const lines = useBlueprintsStore.getState().logs.n1
    expect(lines).toHaveLength(1500)
    expect(lines[0].text).toBe("l1")
    expect(lines.at(-1)?.stream).toBe("system")
  })
})
