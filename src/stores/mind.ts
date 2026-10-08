/**
 * MindMirror store: the modded models, their chat turns (Bilinç → Eylem → memory), the Eylem terminal and the
 * slash commands. Messages live in the chats store (kind "mind"), memory in the memory store (layer "mind").
 */
import { create } from "zustand"
import type { MemoryEntry, Message, MindActor, MindModel, ProviderId, TerminalLine } from "@/domain"
import { newMindModel, parseModelRef } from "@/domain"
import { interpretGateway } from "@/engine/gateway"
import { parseMindCommand, MIND_COMMAND_HELP, type MindCommand } from "@/engine/mind/commands"
import { runMindTurn, type MindStage } from "@/engine/mind/turn"
import { terminalBrief } from "@/engine/mind/prompts"
import { runSingle } from "@/engine/blueprint/single"
import { clampEffort } from "@/engine/effort"
import { getBackend } from "@/services"
import type { AutostartRequest } from "@/services/backend"
import { useChatsStore } from "./chats"
import { useMemoryStore } from "./memory"
import { useProvidersStore } from "./providers"
import { useNotifyStore, reportError } from "./notify"
import { newId } from "@/lib/ids"

export type MindBusy = MindStage | "terminal"
export type MindAutorun = NonNullable<AutostartRequest["mind"]>

const TERMINAL_CAP = 1500
const TERMINAL_FLUSH_MS = 100
const TERMINAL_TIMEOUT = 40 * 60

interface MindState {
  models: MindModel[]
  activeId?: string
  /** Pending `silent mind …` request; the Mind screen consumes it once the models are loaded. */
  autorun?: MindAutorun
  busy: Record<string, MindBusy | undefined>
  running: Record<string, { cancel: () => Promise<void> }>
  /** Eylem terminal lines per model (not persisted; batched, capped). */
  terminal: Record<string, TerminalLine[]>
  terminalVersion: Record<string, number>
  load(): Promise<void>
  create(name?: string): Promise<MindModel>
  update(id: string, patch: Partial<MindModel> | ((m: MindModel) => MindModel)): Promise<void>
  remove(id: string): Promise<void>
  setActive(id: string | undefined): void
  byId(id: string | undefined): MindModel | undefined
  setAutorun(req: MindAutorun | undefined): void
  /** Start: both halves must be available; creates the chat, derives the gateway profile, marks the model started. */
  start(id: string): Promise<boolean>
  /** Reset: chat messages and live memory go, the pinned depot and the model itself stay. */
  reset(id: string): Promise<void>
  /** Chat input: a slash command or one Bilinç → Eylem turn. */
  send(id: string, text: string): Promise<void>
  /** Terminal input: a slash command or an Eylem session in the workspace. */
  terminalRun(id: string, text: string): Promise<void>
  cancel(id: string): Promise<void>
  /** Applies a slash command and returns the reply shown to the user. */
  applyCommand(id: string, cmd: MindCommand): Promise<string>
  appendTerminal(id: string, line: TerminalLine): void
  clearTerminal(id: string): void
  /** Live memory + depot of one model (pure filter; callers memoise on `entries`). */
  memoryOf(id: string): MemoryEntry[]
}

const EMPTY: TerminalLine[] = []
const terminalBuffers = new Map<string, TerminalLine[]>()
let terminalTimer: ReturnType<typeof setTimeout> | undefined

function refOf(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

function isAvailable(ref: string): boolean {
  if (!ref.includes(":")) return false
  return useProvidersStore
    .getState()
    .availableModels()
    .some((m) => refOf(m.providerId, m.id) === ref)
}

function actorMessage(model: MindModel, chatId: string, actor: MindActor, createdAt: number): Message {
  const ref = actor === "bilinc" ? model.bilinc.modelRef : model.eylem.modelRef
  const { providerId, modelId } = parseModelRef(ref)
  return { id: newId("msg"), chatId, role: "assistant", content: "", blocks: [{ type: "mind-actor", actor, modelRef: ref, phase: model.mode }], providerId: providerId as ProviderId, modelId, streaming: true, createdAt }
}

function systemMessage(chatId: string, content: string): Message {
  return { id: newId("msg"), chatId, role: "system", content, blocks: [], createdAt: Date.now() }
}

export const useMindStore = create<MindState>((set, get) => ({
  models: [],
  busy: {},
  running: {},
  terminal: {},
  terminalVersion: {},
  async load() {
    const backend = await getBackend()
    const models = (await backend.db.mindModels.list()).sort((a, b) => b.updatedAt - a.updatedAt)
    set({ models })
  },
  async create(name) {
    const now = Date.now()
    const n = get().models.length + 1
    const model = newMindModel({ id: newId("mind"), name: name?.trim() || `Mind ${n}`, now })
    set({ models: [model, ...get().models], activeId: model.id })
    const backend = await getBackend()
    await backend.db.mindModels.upsert(model)
    return model
  },
  async update(id, patch) {
    const current = get().byId(id)
    if (!current) return
    const next = typeof patch === "function" ? patch(current) : { ...current, ...patch }
    next.updatedAt = Date.now()
    set({ models: get().models.map((m) => (m.id === id ? next : m)) })
    const backend = await getBackend()
    await backend.db.mindModels.upsert(next)
  },
  async remove(id) {
    const model = get().byId(id)
    if (!model) return
    await get().cancel(id)
    set({ models: get().models.filter((m) => m.id !== id), activeId: get().activeId === id ? undefined : get().activeId })
    if (model.chatId) await useChatsStore.getState().remove(model.chatId)
    const mem = useMemoryStore.getState()
    for (const e of mem.entries.filter((e) => e.layer === "mind" && e.scopeId === id)) await mem.remove(e.id)
    get().clearTerminal(id)
    const backend = await getBackend()
    await backend.db.mindModels.delete(id)
  },
  setActive(id) {
    set({ activeId: id })
  },
  byId(id) {
    return id ? get().models.find((m) => m.id === id) : undefined
  },
  setAutorun(req) {
    set({ autorun: req })
  },
  async start(id) {
    const model = get().byId(id)
    if (!model) return false
    for (const [label, ref] of [["Bilinç", model.bilinc.modelRef], ["Eylem", model.eylem.modelRef]] as const) {
      if (!isAvailable(ref)) {
        useNotifyStore.getState().push("error", `${label}: ${ref || "—"} kurulu/etkin bir CLI modeli değil`)
        return false
      }
    }
    let chatId = model.chatId
    if (!chatId || !useChatsStore.getState().byId(chatId)) {
      const { providerId, modelId } = parseModelRef(model.bilinc.modelRef)
      const chat = await useChatsStore.getState().create({ kind: "mind", providerId: providerId as ProviderId, modelId, title: model.name, repoPath: model.workspace, gatewayPrompt: model.gateway.prompt || undefined })
      chatId = chat.id
    } else await useChatsStore.getState().loadMessages(chatId)
    const prompt = model.gateway.prompt.trim()
    await get().update(id, { status: "started", startedAt: Date.now(), chatId, gateway: { prompt: model.gateway.prompt, profile: prompt ? interpretGateway(prompt) : undefined } })
    return true
  },
  async reset(id) {
    const model = get().byId(id)
    if (!model) return
    await get().cancel(id)
    if (model.chatId) await useChatsStore.getState().purgeMessages(model.chatId)
    const mem = useMemoryStore.getState()
    for (const e of mem.entries.filter((e) => e.layer === "mind" && e.scopeId === id && !e.pinned)) await mem.remove(e.id)
    get().clearTerminal(id)
    await get().update(id, { sessions: {}, startedAt: model.status === "started" ? Date.now() : model.startedAt })
  },
  async send(id, text) {
    const model = get().byId(id)
    const content = text.trim()
    if (!model || !content) return
    const chats = useChatsStore.getState()
    const cmd = parseMindCommand(content)
    if (cmd) {
      const reply = await get().applyCommand(id, cmd)
      const chatId = get().byId(id)?.chatId
      if (chatId) await chats.putMessage(systemMessage(chatId, reply))
      return
    }
    if (model.status !== "started" || !model.chatId) {
      useNotifyStore.getState().push("info", "Önce Start'a bas: model henüz kurulmadı")
      return
    }
    if (get().busy[id]) {
      useNotifyStore.getState().push("info", "Model meşgul: önceki tur bitsin ya da iptal et")
      return
    }
    const chatId = model.chatId
    const backend = await getBackend()
    await chats.putMessage({ id: newId("msg"), chatId, role: "user", content, blocks: [], createdAt: Date.now() })
    const memory = get().memoryOf(id)
    const live: Partial<Record<MindActor, Message>> = {}
    const turn = runMindTurn(backend, model, content, memory, {
      onStart: (stage) => {
        set({ busy: { ...get().busy, [id]: stage } })
        if (stage === "memory") return
        const m = actorMessage(model, chatId, stage, Date.now())
        live[stage] = m
        void chats.putMessage(m, false)
      },
      onDelta: (actor, t) => {
        const m = live[actor]
        if (!m) return
        m.content += t
        void chats.putMessage({ ...m }, false)
      },
      onLine: (stage, line, stream) => get().appendTerminal(id, { ts: Date.now(), stream, text: `[${stage}] ${line}` }),
      onMessage: (actor, r) => {
        const m = live[actor]
        if (!m) return
        const done: Message = { ...m, content: r.text || (r.error ? "" : m.content), error: r.error, streaming: false, usage: { inputTokens: 0, outputTokens: 0, totalTokens: r.tokens } }
        live[actor] = done
        void chats.putMessage(done)
      },
      onMemory: (lines) => {
        const mem = useMemoryStore.getState()
        for (const body of lines) void mem.add({ layer: "mind", scopeId: id, scopeLabel: model.name, tags: ["auto"], title: "", body, source: "auto", pinned: false })
      },
    })
    set({ running: { ...get().running, [id]: { cancel: turn.cancel } } })
    try {
      const r = await turn.done
      const sessions = { ...model.sessions, bilinc: r.bilinc.sessionId ?? model.sessions.bilinc, eylem: r.eylem?.sessionId ?? model.sessions.eylem }
      await get().update(id, (m) => ({ ...m, sessions, tokens: (m.tokens ?? 0) + r.tokens }))
      if (r.planned) await chats.putMessage(systemMessage(chatId, "Plan modu: Eylem çalıştırılmadı (/act ile aç)"))
      if (r.cancelled) await chats.putMessage(systemMessage(chatId, "İptal edildi"))
    } catch (e) {
      reportError(e, "Mind")
    } finally {
      const running = { ...get().running }
      delete running[id]
      set({ running, busy: { ...get().busy, [id]: undefined } })
    }
  },
  async terminalRun(id, text) {
    const model = get().byId(id)
    const content = text.trim()
    if (!model || !content) return
    const cmd = parseMindCommand(content)
    if (cmd) {
      const reply = await get().applyCommand(id, cmd)
      get().appendTerminal(id, { ts: Date.now(), stream: "system", text: reply })
      return
    }
    if (model.status !== "started") {
      get().appendTerminal(id, { ts: Date.now(), stream: "system", text: "Önce Start'a bas" })
      return
    }
    if (get().busy[id]) {
      get().appendTerminal(id, { ts: Date.now(), stream: "system", text: "meşgul — bekle ya da iptal et" })
      return
    }
    const backend = await getBackend()
    set({ busy: { ...get().busy, [id]: "terminal" } })
    get().appendTerminal(id, { ts: Date.now(), stream: "system", text: `$ ${content}` })
    const run = runSingle(
      backend,
      {
        runId: `mind:term:${id}:${Date.now()}`,
        modelRef: model.eylem.modelRef,
        prompt: terminalBrief(model, get().memoryOf(id), content),
        cwd: model.workspace,
        readOnly: !model.tools.files,
        network: model.tools.network,
        resumeSessionId: model.sessions.terminal,
        timeoutSecs: TERMINAL_TIMEOUT,
        effort: clampEffort(parseModelRef(model.eylem.modelRef).providerId as ProviderId, model.eylem.effort),
      },
      (line, stream) => get().appendTerminal(id, { ts: Date.now(), stream, text: `[terminal] ${line}` }),
    )
    set({ running: { ...get().running, [id]: { cancel: run.cancel } } })
    try {
      const r = await run.done
      if (!r.ok) get().appendTerminal(id, { ts: Date.now(), stream: "stderr", text: r.error ?? "failed" })
      await get().update(id, (m) => ({ ...m, sessions: { ...m.sessions, terminal: r.sessionId ?? m.sessions.terminal }, tokens: (m.tokens ?? 0) + r.tokens }))
      if (model.workspace && model.tools.shell) await backend.projectSweep(model.workspace).catch(() => 0)
    } catch (e) {
      reportError(e, "Mind terminal")
    } finally {
      const running = { ...get().running }
      delete running[id]
      set({ running, busy: { ...get().busy, [id]: undefined } })
    }
  },
  async cancel(id) {
    const h = get().running[id]
    if (!h) return
    try {
      await h.cancel()
    } catch (e) {
      reportError(e, "Mind cancel")
    }
  },
  async applyCommand(id, cmd) {
    const model = get().byId(id)
    if (!model) return "model yok"
    switch (cmd.kind) {
      case "model": {
        if (!isAvailable(cmd.modelRef)) return `${cmd.modelRef}: kurulu/etkin bir CLI modeli değil`
        const sessions = { ...model.sessions, [cmd.actor]: undefined, ...(cmd.actor === "eylem" ? { terminal: undefined } : {}) }
        await get().update(id, cmd.actor === "bilinc" ? { bilinc: { ...model.bilinc, modelRef: cmd.modelRef }, sessions } : { eylem: { ...model.eylem, modelRef: cmd.modelRef }, sessions })
        return `${cmd.actor === "bilinc" ? "Bilinç" : "Eylem"} → ${cmd.modelRef} (yeni oturum)`
      }
      case "plan":
        await get().update(id, { mode: "plan" })
        return "Plan modu: Bilinç yalnız plan yazar, Eylem çalışmaz (/act ile geri dön)"
      case "act":
        await get().update(id, { mode: "act" })
        return "Eylem modu: Bilinç gerekirse Eylem'e devreder"
      case "effort": {
        const bilinc = !cmd.actor || cmd.actor === "bilinc" ? { ...model.bilinc, effort: cmd.effort } : model.bilinc
        const eylem = !cmd.actor || cmd.actor === "eylem" ? { ...model.eylem, effort: cmd.effort } : model.eylem
        await get().update(id, { bilinc, eylem })
        return `effort ${cmd.actor ?? "bilinç+eylem"} → ${cmd.effort}`
      }
      case "hatirla": {
        const e = await useMemoryStore.getState().add({ layer: "mind", scopeId: id, scopeLabel: model.name, tags: ["user"], title: "", body: cmd.text, source: "user", pinned: false })
        return `hafızaya alındı (${e.id})`
      }
      case "unut": {
        const e = useMemoryStore.getState().entries.find((x) => x.id === cmd.id && x.layer === "mind" && x.scopeId === id)
        if (!e) return `hafızada yok: ${cmd.id}`
        await useMemoryStore.getState().remove(e.id)
        return `unutuldu: ${e.body.slice(0, 60)}`
      }
      case "reset":
        await get().reset(id)
        return "sıfırlandı: sohbet ve canlı hafıza silindi, depo kaldı"
      case "durum": {
        const mem = get().memoryOf(id)
        return [
          `${model.name} · ${model.status === "started" ? "çalışıyor" : "taslak"} · mod ${model.mode}`,
          `Bilinç ${model.bilinc.modelRef}${model.bilinc.effort ? ` (${model.bilinc.effort})` : ""}${model.sessions.bilinc ? " · oturum var" : ""}`,
          `Eylem ${model.eylem.modelRef}${model.eylem.effort ? ` (${model.eylem.effort})` : ""}${model.sessions.eylem ? " · oturum var" : ""}`,
          `araçlar: ${Object.entries(model.tools).filter(([, v]) => v).map(([k]) => k).join(", ") || "yok"}`,
          `klasör: ${model.workspace ?? "—"} · hafıza ${mem.length} (${mem.filter((e) => e.pinned).length} depo) · Σ ${model.tokens ?? 0} token`,
        ].join("\n")
      }
      case "yardim":
        return MIND_COMMAND_HELP.join("\n")
      case "unknown":
        return `bilinmeyen komut: /${cmd.name} — /yardim`
    }
  },
  appendTerminal(id, line) {
    const buf = terminalBuffers.get(id) ?? []
    buf.push(line)
    terminalBuffers.set(id, buf)
    if (terminalTimer) return
    terminalTimer = setTimeout(() => {
      terminalTimer = undefined
      flushMindTerminal()
    }, TERMINAL_FLUSH_MS)
  },
  clearTerminal(id) {
    terminalBuffers.delete(id)
    set({ terminal: { ...get().terminal, [id]: EMPTY }, terminalVersion: { ...get().terminalVersion, [id]: (get().terminalVersion[id] ?? 0) + 1 } })
  },
  memoryOf(id) {
    return useMemoryStore.getState().entries.filter((e) => e.layer === "mind" && e.scopeId === id)
  },
}))

/** Publish buffered terminal lines (also a test helper). */
export function flushMindTerminal(): void {
  if (terminalTimer) {
    clearTimeout(terminalTimer)
    terminalTimer = undefined
  }
  if (!terminalBuffers.size) return
  const s = useMindStore.getState()
  const terminal = { ...s.terminal }
  const terminalVersion = { ...s.terminalVersion }
  for (const [id, pending] of terminalBuffers) {
    const merged = [...(terminal[id] ?? []), ...pending]
    terminal[id] = merged.length > TERMINAL_CAP ? merged.slice(merged.length - TERMINAL_CAP) : merged
    terminalVersion[id] = (terminalVersion[id] ?? 0) + 1
  }
  terminalBuffers.clear()
  useMindStore.setState({ terminal, terminalVersion })
}
