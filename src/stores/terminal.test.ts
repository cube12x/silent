import { describe, expect, it } from "vitest"
import { flushTerminalBuffers, useTerminalStore } from "./terminal"

describe("terminal store", () => {
  it("batches appends and caps memory per subtask", () => {
    const before = useTerminalStore.getState().versions.a ?? 0
    for (let i = 0; i < 2000; i++) useTerminalStore.getState().append("a", { ts: i, stream: "stdout", text: `l${i}` })
    // not published yet (throttled)
    expect(useTerminalStore.getState().lines.a ?? []).toHaveLength(0)
    flushTerminalBuffers()
    const lines = useTerminalStore.getState().lines.a
    expect(lines).toHaveLength(1500)
    expect(lines[0].text).toBe("l500")
    expect(useTerminalStore.getState().versions.a).toBe(before + 1)
  })
})
