import { beforeEach, describe, expect, it } from "vitest"
import type { CliRunRequest, ProviderModel, RuntimeEvent } from "@/domain"
import { TestBackend } from "@/services/testBackend"
import { setBackend } from "@/services"
import { useChatsStore } from "./chats"
import { useMemoryStore } from "./memory"
import { useProvidersStore } from "./providers"
import { flushMindTerminal, useMindStore } from "./mind"

const WITH_ACTION = "Üç film olabilir.\n\nEYLEM:\n1. siteyi aç\nDÖNÜŞ: seanslar"

class MindTestBackend extends TestBackend {
  requests: CliRunRequest[] = []
  script: Record<string, string> = { bilinc: WITH_ACTION, eylem: "# SONUÇ\n3 film: A, B, C", mem: "# HATIRLA\n- Kullanıcı sinemayı sever", term: "ls çıktısı: a.txt" }
  override async cliStart(request: CliRunRequest, onEvent: (e: RuntimeEvent) => void) {
    this.requests.push(request)
    const stage = request.runId.split(":")[1] ?? ""
    const text = this.script[stage] ?? "ok"
    queueMicrotask(() => {
      onEvent({ type: "sessionStarted", data: { sessionId: `${stage}-s` } } as RuntimeEvent)
      onEvent({ type: "textDelta", data: { text: text.slice(0, 2) } } as RuntimeEvent)
      onEvent({ type: "agentMessage", data: { text } } as RuntimeEvent)
      onEvent({ type: "usage", data: { inputTokens: 10, outputTokens: 5 } } as RuntimeEvent)
      onEvent({ type: "exited", data: { code: 0 } } as RuntimeEvent)
    })
    return { cancel: async () => {} }
  }
}

function model(id: string, providerId: "claude" | "codex", tier: ProviderModel["tier"] = "frontier"): ProviderModel {
  return { id, providerId, displayName: id, source: "catalog", tier }
}

let backend: MindTestBackend

async function started() {
  const m = await useMindStore.getState().create("Deneme")
  await useMindStore.getState().update(m.id, { bilinc: { modelRef: "claude:opus" }, eylem: { modelRef: "codex:luna" }, workspace: "/tmp/ws" })
  expect(await useMindStore.getState().start(m.id)).toBe(true)
  return useMindStore.getState().byId(m.id)!
}

describe("mind store", () => {
  beforeEach(() => {
    backend = new MindTestBackend()
    setBackend(backend)
    useMindStore.setState({ models: [], busy: {}, running: {}, terminal: {}, terminalVersion: {}, activeId: undefined })
    useChatsStore.setState({ chats: [], messages: {}, streaming: {} })
    useMemoryStore.setState({ entries: [] })
    useProvidersStore.setState((s) => ({
      providers: {
        ...s.providers,
        claude: { ...s.providers.claude, installed: true, enabled: true, models: [model("opus", "claude")] },
        codex: { ...s.providers.codex, installed: true, enabled: true, models: [model("luna", "codex", "fast")] },
      },
      unavailable: [],
    }))
  })

  it("start needs two available halves, creates the mind chat and derives the gateway profile", async () => {
    const m = await useMindStore.getState().create("Deneme")
    expect(await useMindStore.getState().start(m.id)).toBe(false)
    await useMindStore.getState().update(m.id, { bilinc: { modelRef: "claude:opus" }, eylem: { modelRef: "codex:luna" }, gateway: { prompt: "senior backend engineer" } })
    expect(await useMindStore.getState().start(m.id)).toBe(true)
    const s = useMindStore.getState().byId(m.id)!
    expect(s.status).toBe("started")
    expect(s.gateway.profile?.role).toContain("Backend")
    const chat = useChatsStore.getState().byId(s.chatId)!
    expect(chat.kind).toBe("mind")
    expect(chat.providerId).toBe("claude")
    expect((await backend.db.mindModels.list())[0]?.status).toBe("started")
  })

  it("a turn writes user, Bilinç and Eylem messages with actor chips, saves sessions and live memory", async () => {
    const m = await started()
    await useMindStore.getState().send(m.id, "Atarus sinemasına bak")
    const msgs = useChatsStore.getState().messages[m.chatId!]!
    expect(msgs.map((x) => x.role)).toEqual(["user", "assistant", "assistant"])
    expect(msgs[1]).toMatchObject({ content: "Üç film olabilir.", providerId: "claude", modelId: "opus", streaming: false, blocks: [{ type: "mind-actor", actor: "bilinc", modelRef: "claude:opus" }] })
    expect(msgs[2]).toMatchObject({ content: "# SONUÇ\n3 film: A, B, C", providerId: "codex", blocks: [{ type: "mind-actor", actor: "eylem" }] })
    expect(await backend.db.messages.listByChat(m.chatId!)).toHaveLength(3)
    const after = useMindStore.getState().byId(m.id)!
    expect(after.sessions).toEqual({ bilinc: "bilinc-s", eylem: "eylem-s" })
    expect(after.tokens).toBe(45)
    expect(useMindStore.getState().memoryOf(m.id).map((e) => e.body)).toEqual(["Kullanıcı sinemayı sever"])
    expect(backend.requests.map((r) => [r.runId.split(":")[1], r.sandbox, r.cwd])).toEqual([
      ["bilinc", "read-only", "/tmp/ws"],
      ["eylem", "workspace-write", "/tmp/ws"],
      ["mem", "read-only", "/tmp/ws"],
    ])
    flushMindTerminal()
    expect(useMindStore.getState().terminal[m.id]!.some((l) => l.text.startsWith("[eylem] "))).toBe(true)
    expect(useMindStore.getState().busy[m.id]).toBeUndefined()
  })

  it("slash commands switch halves (dropping their session), modes and memory; /plan skips Eylem", async () => {
    const m = await started()
    await useMindStore.getState().send(m.id, "bak")
    await useMindStore.getState().send(m.id, "/model eylem codex:luna")
    expect(useMindStore.getState().byId(m.id)!.sessions.eylem).toBeUndefined()
    expect(useMindStore.getState().byId(m.id)!.sessions.bilinc).toBe("bilinc-s")
    await useMindStore.getState().send(m.id, "/model bilinc nope:x")
    const sys = useChatsStore.getState().messages[m.chatId!]!.filter((x) => x.role === "system")
    expect(sys.at(-1)!.content).toContain("kurulu/etkin")
    await useMindStore.getState().send(m.id, "/plan")
    backend.requests = []
    await useMindStore.getState().send(m.id, "bak")
    expect(backend.requests.map((r) => r.runId.split(":")[1])).toEqual(["bilinc", "mem"])
    expect(useChatsStore.getState().messages[m.chatId!]!.at(-1)!.content).toContain("Plan modu")
    await useMindStore.getState().send(m.id, "/hatirla Ben Ali")
    expect(useMindStore.getState().memoryOf(m.id).some((e) => e.body === "Ben Ali" && e.source === "user")).toBe(true)
    await useMindStore.getState().send(m.id, "/effort bilinc high")
    expect(useMindStore.getState().byId(m.id)!.bilinc.effort).toBe("high")
    expect(useMindStore.getState().byId(m.id)!.eylem.effort).toBeUndefined()
  })

  it("reset purges messages and live memory but keeps the pinned depot; remove drops everything", async () => {
    const m = await started()
    await useMemoryStore.getState().add({ layer: "mind", scopeId: m.id, tags: [], title: "Dil", body: "Türkçe", source: "user", pinned: true })
    await useMindStore.getState().send(m.id, "bak")
    expect(useMindStore.getState().memoryOf(m.id)).toHaveLength(2)
    await useMindStore.getState().reset(m.id)
    expect(useChatsStore.getState().messages[m.chatId!]).toEqual([])
    expect(await backend.db.messages.listByChat(m.chatId!)).toEqual([])
    expect(useMindStore.getState().memoryOf(m.id).map((e) => e.body)).toEqual(["Türkçe"])
    expect(useMindStore.getState().byId(m.id)!.sessions).toEqual({})
    expect(useMindStore.getState().byId(m.id)!.status).toBe("started")
    await useMindStore.getState().remove(m.id)
    expect(useMindStore.getState().models).toEqual([])
    expect(useChatsStore.getState().byId(m.chatId)).toBeUndefined()
    expect(useMemoryStore.getState().entries).toEqual([])
    expect(await backend.db.mindModels.list()).toEqual([])
  })

  it("the terminal runs Eylem in the workspace with its own session", async () => {
    const m = await started()
    await useMindStore.getState().terminalRun(m.id, "ls")
    flushMindTerminal()
    const lines = useMindStore.getState().terminal[m.id]!.map((l) => l.text)
    expect(lines[0]).toBe("$ ls")
    expect(lines.some((t) => t.includes("ls çıktısı"))).toBe(true)
    expect(backend.requests[0]).toMatchObject({ runId: expect.stringMatching(/^mind:term:/), providerId: "codex", sandbox: "workspace-write", cwd: "/tmp/ws" })
    expect(useMindStore.getState().byId(m.id)!.sessions.terminal).toBe("term-s")
    expect(backend.swept).toEqual(["/tmp/ws"])
    await useMindStore.getState().terminalRun(m.id, "/durum")
    flushMindTerminal()
    expect(useMindStore.getState().terminal[m.id]!.at(-1)!.text).toContain("Bilinç claude:opus")
  })
})
