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
  script: Record<string, string> = { bilinc: WITH_ACTION, eylem: "# SONUÇ\n3 film: A, B, C", mem: "# HATIRLA\n- Kullanıcı sinemayı sever", term: "ls çıktısı: a.txt", tek: "Doğrudan cevap." }
  override async cliStart(request: CliRunRequest, onEvent: (e: RuntimeEvent) => void) {
    this.requests.push(request)
    const stage = request.runId.split(":")[1] ?? ""
    const text = this.script[stage] ?? "ok"
    queueMicrotask(() => {
      onEvent({ type: "sessionStarted", data: { sessionId: `${stage}-s` } } as RuntimeEvent)
      onEvent({ type: "textDelta", data: { text: text.slice(0, 2) } } as RuntimeEvent)
      if (stage === "eylem") {
        onEvent({ type: "commandStarted", data: { command: "curl -s https://atarus.example" } } as RuntimeEvent)
        onEvent({ type: "commandCompleted", data: { command: "curl -s https://atarus.example", exitCode: 0, outputTail: "<title>Atarus</title>" } } as RuntimeEvent)
        onEvent({ type: "fileChanged", data: { path: "NOTLAR.md", kind: "add" } } as RuntimeEvent)
      }
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

/** A seeded canvas (Hafıza → Gateway → Bilinç / Eylem, Araçlar → Eylem) with both halves set and a workspace, started. */
async function started() {
  const m = await useMindStore.getState().create("Deneme", { bilinc: "claude:opus", eylem: "codex:luna", workspace: "/tmp/ws" })
  expect(m.graph.nodes.map((n) => n.type).sort()).toEqual(["gateway", "memory", "model", "model", "tools"])
  expect(await useMindStore.getState().start(m.id)).toBe(true)
  return useMindStore.getState().byId(m.id)!
}

describe("mind store (canvas)", () => {
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

  it("Start compiles the canvas, needs installed halves, creates the mind chat and adds the Canlı Hafıza box", async () => {
    const m = await useMindStore.getState().create("Deneme")
    expect(await useMindStore.getState().start(m.id)).toBe(false) // refs empty
    const bilinc = m.graph.nodes.find((n) => n.data.type === "model" && n.data.role === "bilinc")!
    const eylem = m.graph.nodes.find((n) => n.data.type === "model" && n.data.role === "eylem")!
    const gateway = m.graph.nodes.find((n) => n.type === "gateway")!
    useMindStore.getState().updateNode(m.id, bilinc.id, { data: { modelRef: "claude:opus" } })
    useMindStore.getState().updateNode(m.id, eylem.id, { data: { modelRef: "codex:luna" } })
    useMindStore.getState().updateNode(m.id, gateway.id, { data: { prompt: "senior backend engineer" } })
    expect(await useMindStore.getState().start(m.id)).toBe(true)
    const s = useMindStore.getState().byId(m.id)!
    expect(s.status).toBe("started")
    expect(s.bilinc.modelRef).toBe("claude:opus")
    expect(s.eylem.modelRef).toBe("codex:luna")
    expect(s.gateway.profile?.role).toContain("Backend")
    expect(s.graph.nodes.some((n) => n.type === "live")).toBe(true)
    const chat = useChatsStore.getState().byId(s.chatId)!
    expect(chat.kind).toBe("mind")
    expect(chat.providerId).toBe("claude")
    expect((await backend.db.mindModels.list())[0]?.graph.nodes.length).toBe(6)
  })

  it("a turn writes user, Bilinç and Eylem messages with actor chips, saves sessions and live memory", async () => {
    const m = await started()
    await useMindStore.getState().send(m.id, "Atarus sinemasına bak")
    const msgs = useChatsStore.getState().messages[m.chatId!]!
    expect(msgs.map((x) => x.role)).toEqual(["user", "assistant", "assistant"])
    expect(msgs[1]).toMatchObject({ content: "Üç film olabilir.", providerId: "claude", modelId: "opus", streaming: false, blocks: [{ type: "mind-actor", actor: "bilinc", modelRef: "claude:opus" }] })
    expect(msgs[2]).toMatchObject({ content: "# SONUÇ\n3 film: A, B, C", providerId: "codex" })
    // The process the half went through stays on the message: command card (done) + touched files.
    expect(msgs[2]!.blocks).toEqual([
      // Eylem's message carries Bilinç's work order (shown as "İş emri") and the files it planned.
      { type: "mind-actor", actor: "eylem", modelRef: "codex:luna", phase: "act", order: "EYLEM:\n1. siteyi aç\nDÖNÜŞ: seanslar", files: [] },
      { type: "task-card", title: "curl -s https://atarus.example", status: "done", command: "curl -s https://atarus.example", detail: "<title>Atarus</title>" },
      { type: "context", label: "files:add", items: ["NOTLAR.md"] },
    ])
    expect((await backend.db.messages.listByChat(m.chatId!)).at(-1)!.blocks).toHaveLength(3)
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
  })

  it("a lone Model box is tested directly: no EYLEM contract, one 'tek' message", async () => {
    const m = await useMindStore.getState().create("Tek")
    for (const n of m.graph.nodes) useMindStore.getState().removeNode(m.id, n.id)
    useMindStore.getState().addNode(m.id, "model", 0, 0, { type: "model", role: "tek", modelRef: "codex:luna" })
    expect(await useMindStore.getState().start(m.id)).toBe(true)
    const s = useMindStore.getState().byId(m.id)!
    await useMindStore.getState().send(s.id, "selam")
    const msgs = useChatsStore.getState().messages[s.chatId!]!
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toMatchObject({ content: "Doğrudan cevap.", providerId: "codex", blocks: [{ type: "mind-actor", actor: "tek", modelRef: "codex:luna" }] })
    expect(backend.requests.map((r) => r.runId.split(":")[1])).toEqual(["tek"])
    expect(backend.requests[0]!.prompt).not.toContain("EYLEM:")
  })

  it("canvas edits recompile before a turn; wires follow the rules", async () => {
    const m = await started()
    const eylem = m.graph.nodes.find((n) => n.data.type === "model" && n.data.role === "eylem")!
    const bilinc = m.graph.nodes.find((n) => n.data.type === "model" && n.data.role === "bilinc")!
    const tools = m.graph.nodes.find((n) => n.type === "tools")!
    expect(useMindStore.getState().addEdge(m.id, bilinc.id, eylem.id)).toBeNull() // model → model never
    expect(useMindStore.getState().addEdge(m.id, tools.id, bilinc.id)).not.toBeNull()
    useMindStore.getState().updateNode(m.id, tools.id, { data: { tools: { browser: true, files: false, shell: true, network: false, image: false } } })
    await useMindStore.getState().send(m.id, "bak")
    expect(backend.requests[1]).toMatchObject({ sandbox: "read-only", network: false })
    expect(useMindStore.getState().byId(m.id)!.tools.files).toBe(false)
  })

  it("slash commands change the canvas boxes; /plan skips Eylem; reset keeps depot and canvas", async () => {
    const m = await started()
    await useMindStore.getState().send(m.id, "bak")
    await useMindStore.getState().send(m.id, "/model eylem codex:luna")
    expect(useMindStore.getState().byId(m.id)!.sessions.eylem).toBeUndefined()
    await useMindStore.getState().send(m.id, "/model bilinc nope:x")
    expect(useChatsStore.getState().messages[m.chatId!]!.filter((x) => x.role === "system").at(-1)!.content).toContain("kurulu/etkin")
    await useMindStore.getState().send(m.id, "/effort bilinc high")
    const b = useMindStore.getState().byId(m.id)!.graph.nodes.find((n) => n.data.type === "model" && n.data.role === "bilinc")!
    expect(b.data.type === "model" && b.data.effort).toBe("high")
    await useMindStore.getState().send(m.id, "/plan")
    backend.requests = []
    await useMindStore.getState().send(m.id, "bak")
    expect(backend.requests.map((r) => r.runId.split(":")[1])).toEqual(["bilinc", "mem"])
    await useMemoryStore.getState().add({ layer: "mind", scopeId: m.id, tags: [], title: "Dil", body: "Türkçe", source: "user", pinned: true })
    await useMindStore.getState().send(m.id, "/hatirla Ben Ali")
    await useMindStore.getState().reset(m.id)
    expect(useChatsStore.getState().messages[m.chatId!]).toEqual([])
    expect(useMindStore.getState().memoryOf(m.id).map((e) => e.body)).toEqual(["Türkçe"])
    expect(useMindStore.getState().byId(m.id)!.graph.nodes.length).toBe(6)
    await useMindStore.getState().remove(m.id)
    expect(useChatsStore.getState().byId(m.chatId)).toBeUndefined()
    expect(await backend.db.mindModels.list()).toEqual([])
  })

  it("both halves and the terminal share one transcript (ortak bağlam)", async () => {
    const m = await started()
    await useMindStore.getState().send(m.id, "Atarus sinemasına bak")
    backend.requests = []
    await useMindStore.getState().send(m.id, "Peki seanslar?")
    const [bi, ey] = backend.requests
    for (const r of [bi!, ey!]) {
      expect(r.prompt).toContain("# ORTAK BAĞLAM")
      expect(r.prompt).toContain("[Sen] Atarus sinemasına bak")
      expect(r.prompt).toContain("[Bilinç] Üç film olabilir.")
      expect(r.prompt).toContain("[Eylem] # SONUÇ\n3 film: A, B, C")
      expect(r.prompt).not.toContain("[Sen] Peki seanslar?") // the current message is the # USER section, not history
    }
    backend.requests = []
    await useMindStore.getState().terminalRun(m.id, "ls")
    expect(backend.requests[0]!.prompt).toContain("[Sen] Peki seanslar?")
    const note = useChatsStore.getState().messages[m.chatId!]!.at(-1)!
    expect(note.role).toBe("system")
    expect(note.content).toBe("[terminal] $ ls\nls çıktısı: a.txt")
    backend.requests = []
    await useMindStore.getState().send(m.id, "sonra?")
    expect(backend.requests[0]!.prompt).toContain("[Terminal] $ ls\nls çıktısı: a.txt")
  })

  it("live activity: stage and last lines while a turn runs, thoughts when a Düşünme box exists, idle after", async () => {
    const m = await started()
    backend.script.bilinc = "DÜŞÜNCE:\n- bakıyorum\n\n" + WITH_ACTION
    const seen: Array<string | undefined> = []
    const unsub = useMindStore.subscribe((s) => seen.push(s.activity[m.id]?.stage))
    await useMindStore.getState().send(m.id, "bak")
    unsub()
    expect(seen).toContain("bilinc")
    expect(seen).toContain("eylem")
    expect(seen).toContain("memory")
    const a = useMindStore.getState().activity[m.id]!
    expect(a.stage).toBeUndefined()
    expect(a.last.bilinc).toContain("Üç film")
    expect(a.last.eylem).toContain("SONUÇ")
    // No Düşünme box → Bilinç is not asked to think aloud; a DÜŞÜNCE block it wrote anyway is still lifted out of the chat.
    expect(backend.requests[0]!.prompt).not.toContain("DÜŞÜNCE:")
    expect(a.thoughts.some((x) => x.kind === "dusunce")).toBe(true)
    expect(useChatsStore.getState().messages[m.chatId!]![1]!.content).not.toContain("bakıyorum")
    useMindStore.getState().addNode(m.id, "thinking", 0, 0)
    backend.requests = []
    await useMindStore.getState().send(m.id, "tekrar bak")
    expect(backend.requests[0]!.prompt).toContain("DÜŞÜNCE:")
    const b = useMindStore.getState().activity[m.id]!
    expect(b.thoughts.some((x) => x.kind === "dusunce" && x.text === "- bakıyorum")).toBe(true)
    expect(useChatsStore.getState().messages[m.chatId!]!.at(-2)!.content).not.toContain("bakıyorum")
    flushMindTerminal()
    expect(useMindStore.getState().terminal[m.id]!.some((l) => l.text.startsWith("[bilinc] 💭"))).toBe(true)
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
    await useMindStore.getState().terminalRun(m.id, "/durum")
    flushMindTerminal()
    expect(useMindStore.getState().terminal[m.id]!.at(-1)!.text).toContain("Bilinç+Eylem")
  })
})
