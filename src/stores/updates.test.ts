import { beforeEach, describe, expect, it, vi } from "vitest"
import { TestBackend } from "@/services/testBackend"
import { useBlueprintsStore } from "./blueprints"
import { useRunsStore } from "./runs"
import { UPDATE_IDLE_MS, useUpdatesStore } from "./updates"

const backend = new TestBackend()
vi.mock("@/services", () => ({ getBackend: async () => backend }))

describe("`silent update`: install when idle, drain meanwhile (2026-10-04)", () => {
  beforeEach(() => {
    backend.pendingUpdate = null
    backend.applied = []
    useUpdatesStore.setState({ pending: null, idleSince: undefined, applying: false })
    useBlueprintsStore.setState({ running: {} })
    useRunsStore.setState({ runs: [] })
  })
  it("does nothing without a queued update", async () => {
    expect(await useUpdatesStore.getState().tick(1000)).toBe(false)
    expect(useUpdatesStore.getState().pending).toBeNull()
  })
  it("waits for two idle minutes, resets the idle clock when something runs, then applies", async () => {
    backend.pendingUpdate = "/tmp/New.app"
    expect(await useUpdatesStore.getState().tick(0)).toBe(false)
    expect(useUpdatesStore.getState().pending).toBe("/tmp/New.app")
    useBlueprintsStore.setState({ running: { n1: () => undefined } })
    expect(await useUpdatesStore.getState().tick(UPDATE_IDLE_MS)).toBe(false)
    useBlueprintsStore.setState({ running: {} })
    expect(await useUpdatesStore.getState().tick(UPDATE_IDLE_MS + 1)).toBe(false) // idle clock restarted
    expect(await useUpdatesStore.getState().tick(2 * UPDATE_IDLE_MS + 2)).toBe(true)
    expect(backend.applied).toEqual(["/tmp/New.app"])
  })
})
