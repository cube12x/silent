import { describe, expect, it } from "vitest"
import type { CliRunRequest, RuntimeEvent } from "@/domain"
import { runSingle } from "./single"

function backend(events: RuntimeEvent[]) {
  const requests: CliRunRequest[] = []
  return {
    requests,
    cliStart: async (request: CliRunRequest, onEvent: (e: RuntimeEvent) => void) => {
      requests.push(request)
      queueMicrotask(() => {
        for (const e of events) onEvent(e)
      })
      return { cancel: async () => {} }
    },
  }
}

describe("runSingle", () => {
  it("streams text deltas and keeps whole messages for the result", async () => {
    const b = backend([
      { type: "sessionStarted", data: { sessionId: "s9" } },
      { type: "textDelta", data: { text: "Mer" } },
      { type: "textDelta", data: { text: "haba" } },
      { type: "agentMessage", data: { text: "Merhaba" } },
      { type: "usage", data: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 40 } },
      { type: "exited", data: { code: 0 } },
    ] as RuntimeEvent[])
    const deltas: string[] = []
    const r = await runSingle(b, { runId: "t1", modelRef: "codex:gpt", prompt: "hi", onDelta: (t) => deltas.push(t) }).done
    expect(deltas.join("")).toBe("Merhaba")
    expect(r).toMatchObject({ ok: true, text: "Merhaba", sessionId: "s9", tokens: 70 })
  })
  it("read-only never has network; workspace-write may switch it off", async () => {
    const b = backend([{ type: "exited", data: { code: 0 } }] as RuntimeEvent[])
    await runSingle(b, { runId: "a", modelRef: "codex:gpt", prompt: "x", readOnly: true, network: true }).done
    await runSingle(b, { runId: "b", modelRef: "codex:gpt", prompt: "x" }).done
    await runSingle(b, { runId: "c", modelRef: "codex:gpt", prompt: "x", network: false }).done
    expect(b.requests.map((r) => [r.sandbox, r.network])).toEqual([
      ["read-only", false],
      ["workspace-write", true],
      ["workspace-write", false],
    ])
  })
})
