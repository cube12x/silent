import { describe, expect, it } from "vitest"
import type { MessageBlock, RuntimeEvent } from "@/domain"
import { applyProcessEvent, pushTail } from "./process"

describe("applyProcessEvent", () => {
  it("turns commands into cards that complete, and file changes into a files list", () => {
    const blocks: MessageBlock[] = []
    applyProcessEvent(blocks, { type: "commandStarted", data: { command: "npm test" } } as RuntimeEvent)
    expect(blocks[0]).toMatchObject({ type: "task-card", status: "running", command: "npm test" })
    applyProcessEvent(blocks, { type: "commandCompleted", data: { command: "npm test", exitCode: 1, outputTail: "a\n\nb\nFAIL" } } as RuntimeEvent)
    expect(blocks[0]).toMatchObject({ type: "task-card", status: "failed", detail: "a\nb\nFAIL" })
    applyProcessEvent(blocks, { type: "fileChanged", data: { path: "src/a.ts", kind: "add" } } as RuntimeEvent)
    applyProcessEvent(blocks, { type: "fileChanged", data: { path: "src/a.ts", kind: "add" } } as RuntimeEvent)
    applyProcessEvent(blocks, { type: "fileChanged", data: { path: "src/b.ts", kind: "update" } } as RuntimeEvent)
    expect(blocks.filter((b) => b.type === "context")).toEqual([
      { type: "context", label: "files:add", items: ["src/a.ts"] },
      { type: "context", label: "files:update", items: ["src/b.ts"] },
    ])
    expect(applyProcessEvent(blocks, { type: "usage", data: { inputTokens: 1, outputTokens: 1 } } as RuntimeEvent)).toBe(false)
  })
  it("a completion without a matching start still lands as a card", () => {
    const blocks: MessageBlock[] = []
    applyProcessEvent(blocks, { type: "commandCompleted", data: { command: "ls", exitCode: 0, outputTail: "a.txt" } } as RuntimeEvent)
    expect(blocks[0]).toMatchObject({ type: "task-card", status: "done", detail: "a.txt" })
  })
})

describe("pushTail", () => {
  it("keeps the last lines, skips blanks, clips long ones", () => {
    let t: string[] = []
    for (let i = 0; i < 12; i++) t = pushTail(t, i === 5 ? "   " : `line ${i}`)
    expect(t).toHaveLength(8)
    expect(t[0]).toBe("line 3")
    expect(pushTail([], "x".repeat(300))[0]!.length).toBe(200)
  })
})
