import { beforeEach, describe, expect, it, vi } from "vitest"
import { UPDATE_IDLE_MS, useUpdatesStore } from "./updates"
import { useBlueprintsStore } from "./blueprints"
import { useRunsStore } from "./runs"

let applyError: string | null = null
const applied: string[] = []
vi.mock("@/services", () => ({
  getBackend: async () => ({
    updatePending: async () => "/tmp/New.app",
    updateApply: async (p: string) => {
      applied.push(p)
      if (applyError) throw new Error(applyError)
    },
  }),
}))

describe("queued update: retry vs drop (2026-10-05 E8)", () => {
  beforeEach(() => {
    applied.length = 0
    useBlueprintsStore.setState({ running: {} })
    useRunsStore.setState({ runs: [] })
    useUpdatesStore.setState({ pending: null, idleSince: undefined, applying: false })
  })
  it("a `retry:` error keeps the queue (the bundle is still being built) and retries on a later tick", async () => {
    applyError = "retry: bundle written 10 s ago"
    const t0 = 1_000_000
    await useUpdatesStore.getState().tick(t0)
    await useUpdatesStore.getState().tick(t0 + UPDATE_IDLE_MS + 1)
    expect(applied).toHaveLength(1)
    const s = useUpdatesStore.getState()
    expect(s.pending).toBe("/tmp/New.app")
    expect(s.applying).toBe(false)
    expect(s.idleSince).toBe(t0)
    await useUpdatesStore.getState().tick(t0 + UPDATE_IDLE_MS + 2)
    expect(applied).toHaveLength(2)
  })
  it("any other error drops the queue so the drain gate opens", async () => {
    applyError = "/tmp/New.app is not an app bundle"
    const t0 = 1_000_000
    await useUpdatesStore.getState().tick(t0)
    await useUpdatesStore.getState().tick(t0 + UPDATE_IDLE_MS + 1)
    expect(useUpdatesStore.getState().pending).toBeNull()
    expect(useUpdatesStore.getState().applying).toBe(false)
  })
})
