import { beforeEach, describe, expect, it, vi } from "vitest"
import { reportError, useNotifyStore } from "./notify"

describe("notify", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useNotifyStore.setState({ toasts: [] })
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })
  it("surfaces an error once (deduplicated) and links planner errors to Setup", () => {
    reportError(new Error("no planner-capable CLI (Claude or Codex) is installed"), "blueprint")
    reportError(new Error("no planner-capable CLI (Claude or Codex) is installed"), "blueprint")
    const toasts = useNotifyStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].kind).toBe("error")
    expect(toasts[0].action?.to).toBe("/setup")
    vi.advanceTimersByTime(10_000)
    expect(useNotifyStore.getState().toasts).toHaveLength(0)
  })
  it("keeps at most five toasts", () => {
    for (let i = 0; i < 8; i++) useNotifyStore.getState().push("info", `m${i}`)
    expect(useNotifyStore.getState().toasts).toHaveLength(5)
  })
})
