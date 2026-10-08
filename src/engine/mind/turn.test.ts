import { describe, expect, it } from "vitest"
import type { CliRunRequest, MindModel, RuntimeEvent } from "@/domain"
import { newMindModel } from "@/domain"
import { runMindTurn } from "./turn"

type Script = Record<"bilinc" | "eylem" | "mem", string>

/** cliStart keyed by the run id prefix: each half replays its own transcript. */
function backend(script: Partial<Script>, opts: { fail?: "bilinc" | "eylem" | "mem" } = {}) {
  const requests: CliRunRequest[] = []
  let cancels = 0
  return {
    requests,
    cancels: () => cancels,
    cliStart: async (request: CliRunRequest, onEvent: (e: RuntimeEvent) => void) => {
      requests.push(request)
      const stage = request.runId.split(":")[1] as keyof Script
      const text = script[stage] ?? ""
      queueMicrotask(() => {
        onEvent({ type: "sessionStarted", data: { sessionId: `${stage}-session` } } as RuntimeEvent)
        if (opts.fail === stage) onEvent({ type: "failed", data: { code: "error", message: `${stage} failed`, retryable: false } } as RuntimeEvent)
        else {
          onEvent({ type: "textDelta", data: { text: text.slice(0, 3) } } as RuntimeEvent)
          onEvent({ type: "agentMessage", data: { text } } as RuntimeEvent)
          onEvent({ type: "usage", data: { inputTokens: 10, outputTokens: 5 } } as RuntimeEvent)
        }
        onEvent({ type: "exited", data: { code: 0 } } as RuntimeEvent)
      })
      return {
        cancel: async () => {
          cancels += 1
        },
      }
    },
  }
}

const model: MindModel = {
  ...newMindModel({ id: "m1", name: "Deneme", now: 1, bilincRef: "claude:opus", eylemRef: "codex:gpt-5.6-luna" }),
  workspace: "/tmp/ws",
  sessions: { bilinc: "b-old", eylem: "e-old" },
  bilinc: { modelRef: "claude:opus", effort: "high" },
  eylem: { modelRef: "codex:gpt-5.6-luna", effort: "xhigh" },
}
const WITH_ACTION = "Atarus'ta üç film olabilir.\n\nEYLEM:\n1. https://atarus.example açılır\n2. filmler listelenir\nDÖNÜŞ: film + seans"

describe("runMindTurn", () => {
  it("runs Bilinç read-only, then Eylem in the workspace, then memory", async () => {
    const b = backend({ bilinc: WITH_ACTION, eylem: "# SONUÇ\n3 film: A, B, C", mem: "# HATIRLA\n- Kullanıcı Atarus sinemasını takip ediyor" })
    const messages: string[] = []
    const deltas: string[] = []
    const r = await runMindTurn(b, model, "Atarus sinemasına bak", [], { onMessage: (a, m) => messages.push(`${a}:${m.text}`), onDelta: (a, t) => deltas.push(`${a}:${t}`) }, { now: () => 7 }).done
    expect(r.ok).toBe(true)
    expect(r.bilinc.text).toBe("Atarus'ta üç film olabilir.")
    expect(r.bilinc.sessionId).toBe("bilinc-session")
    expect(r.eylem?.text).toContain("3 film")
    expect(r.eylemBlock?.steps).toHaveLength(2)
    expect(r.remembered).toEqual(["Kullanıcı Atarus sinemasını takip ediyor"])
    expect(r.tokens).toBe(45)
    expect(messages).toEqual(["bilinc:Atarus'ta üç film olabilir.", "eylem:# SONUÇ\n3 film: A, B, C"])
    expect(deltas[0]).toBe("bilinc:Ata")

    const [bi, ey, mem] = b.requests
    expect(bi).toMatchObject({ runId: "mind:bilinc:m1:7", providerId: "claude", modelId: "opus", sandbox: "read-only", network: false, resumeSessionId: "b-old", cwd: "/tmp/ws", effort: "high" })
    expect(bi!.prompt).toContain("READ-ONLY")
    expect(ey).toMatchObject({ runId: "mind:eylem:m1:7", providerId: "codex", sandbox: "workspace-write", network: true, resumeSessionId: "e-old", cwd: "/tmp/ws", effort: "xhigh" })
    expect(ey!.prompt).toContain("# EYLEM:\n1. https://atarus.example açılır")
    expect(mem).toMatchObject({ runId: "mind:mem:m1:7", providerId: "codex", sandbox: "read-only", effort: "low" })
    expect(mem!.resumeSessionId).toBeUndefined()
  })
  it("skips Eylem when the mind needs no action, and in plan mode", async () => {
    const b = backend({ bilinc: "Sadece bir fikir.", mem: "# HATIRLA\nnone" })
    const r = await runMindTurn(b, model, "selam", []).done
    expect(r.eylem).toBeUndefined()
    expect(r.planned).toBe(false)
    expect(r.remembered).toEqual([])
    expect(b.requests.map((q) => q.runId.split(":")[1])).toEqual(["bilinc", "mem"])

    const p = backend({ bilinc: WITH_ACTION })
    const pr = await runMindTurn(p, { ...model, mode: "plan" }, "bak", [], {}, { extractMemory: false }).done
    expect(pr.eylem).toBeUndefined()
    expect(pr.planned).toBe(true)
    expect(p.requests).toHaveLength(1)
  })
  it("honours the tools: files off → Eylem read-only, network off → no network", async () => {
    const b = backend({ bilinc: WITH_ACTION, eylem: "# SONUÇ\nok" })
    await runMindTurn(b, { ...model, tools: { ...model.tools, files: false, network: false } }, "bak", [], {}, { extractMemory: false }).done
    expect(b.requests[1]).toMatchObject({ sandbox: "read-only", network: false })
    const c = backend({ bilinc: WITH_ACTION, eylem: "# SONUÇ\nok" })
    await runMindTurn(c, { ...model, tools: { ...model.tools, network: false } }, "bak", [], {}, { extractMemory: false }).done
    expect(c.requests[1]).toMatchObject({ sandbox: "workspace-write", network: false })
  })
  it("a failed Bilinç ends the turn; a failed memory call does not fail it", async () => {
    const b = backend({ bilinc: WITH_ACTION }, { fail: "bilinc" })
    const r = await runMindTurn(b, model, "bak", []).done
    expect(r.ok).toBe(false)
    expect(r.error).toBe("bilinc failed")
    expect(b.requests).toHaveLength(1)

    const c = backend({ bilinc: "fikir", mem: "" }, { fail: "mem" })
    const rc = await runMindTurn(c, model, "x", []).done
    expect(rc.ok).toBe(true)
    expect(rc.remembered).toEqual([])
  })
  it("cancel stops the chain after the running half", async () => {
    const b = backend({ bilinc: WITH_ACTION, eylem: "# SONUÇ\nok" })
    const turn = runMindTurn(b, model, "bak", [], { onMessage: () => void turn.cancel() })
    const r = await turn.done
    expect(r.cancelled).toBe(true)
    expect(b.requests).toHaveLength(1)
  })
})
