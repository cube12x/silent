/**
 * MindMirror store: the canvases (boxes + wires), their compiled model, chat turns (Bilinç → Eylem → memory, or a single
 * model directly), the Eylem terminal and the slash commands. Messages live in the chats store (kind "mind"), memory in
 * the memory store (layer "mind").
 */
import { create } from "zustand"
import type { MemoryEntry, Message, MindActor, MindModel, MindNode, MindNodeData, MindNodeType, ProviderId, TerminalLine } from "@/domain"
import { newMindModel, parseModelRef } from "@/domain"
import { interpretGateway } from "@/engine/gateway"
import { parseMindCommand, MIND_COMMAND_HELP, type MindCommand } from "@/engine/mind/commands"
import { parseDusunce } from "@/engine/mind/parse"
import { runMindTurn, type MindStage } from "@/engine/mind/turn"
import { tekBrief, terminalBrief } from "@/engine/mind/prompts"
import { sharedContext, terminalNote } from "@/engine/mind/context"
import { composeMind, defaultNodeData, hasThinking, nextPosition, seedGraph, validateMindEdge, type MindComposition } from "@/engine/mind/graph"
import { runSingle } from "@/engine/blueprint/single"
import { clampEffort } from "@/engine/effort"
import { getBackend } from "@/services"
import type { AutostartRequest } from "@/services/backend"
import { useChatsStore } from "./chats"
import { useMemoryStore } from "./memory"
import { useProvidersStore } from "./providers"
import { useNotifyStore, reportError } from "./notify"
import { newId } from "@/lib/ids"

export type MindBusy = MindStage | "tek" | "terminal"
export type MindAutorun = NonNullable<AutostartRequest["mind"]>

/** What is happening on the canvas right now (and what happened in the last turn): drives the live boxes and wires. */
export interface MindActivity {
  stage?: MindBusy
  /** When the current stage started (ms). */
  since?: number
  /** Last output line per stage (clipped), shown on the box. */
  last: Partial<Record<MindBusy, string>>
  /** Düşünme box feed: reasoning/tool status lines and the DÜŞÜNCE block of this turn. */
  thoughts: Array<{ actor: MindActor; text: string; kind: "reason" | "dusunce"; at: number }>
}
const THOUGHTS_CAP = 40
const EMPTY_ACTIVITY: MindActivity = { last: {}, thoughts: [] }

const TERMINAL_CAP = 1500
const TERMINAL_FLUSH_MS = 100
const TERMINAL_TIMEOUT = 40 * 60
const TEK_TIMEOUT = 40 * 60

interface MindState {
  models: MindModel[]
  activeId?: string
  /** Pending `silent mind …` request; the Mind screen consumes it once the models are loaded. */
  autorun?: MindAutorun
  busy: Record<string, MindBusy | undefined>
  running: Record<string, { cancel: () => Promise<void> }>
  /** Live canvas state per model (not persisted). */
  activity: Record<string, MindActivity>
  /** Eylem terminal lines per model (not persisted; batched, capped). */
  terminal: Record<string, TerminalLine[]>
  terminalVersion: Record<string, number>
  load(): Promise<void>
  /** A new canvas comes seeded: Hafıza → Gateway → Bilinç / Eylem, Araçlar → Eylem. */
  create(name?: string, refs?: { bilinc?: string; eylem?: string; workspace?: string }): Promise<MindModel>
  update(id: string, patch: Partial<MindModel> | ((m: MindModel) => MindModel)): Promise<void>
  remove(id: string): Promise<void>
  setActive(id: string | undefined): void
  byId(id: string | undefined): MindModel | undefined
  setAutorun(req: MindAutorun | undefined): void
  // Canvas
  addNode(id: string, type: MindNodeType, x: number, y: number, data?: Partial<MindNodeData>): MindNode | undefined
  updateNode(id: string, nodeId: string, patch: Partial<Omit<MindNode, "data">> & { data?: Partial<MindNodeData> }): void
  removeNode(id: string, nodeId: string): void
  addEdge(id: string, from: string, to: string): string | null
  removeEdge(id: string, edgeId: string): void
  /** Compile the canvas into the fields the engine runs with (also done before every turn). */
  compile(id: string): MindComposition | undefined
  /** Start: the canvas must compile to a model whose halves are installed; creates the chat, adds the Canlı Hafıza box. */
  start(id: string): Promise<boolean>
  /** Reset: chat messages and live memory go, the pinned depot and the canvas stay. */
  reset(id: string): Promise<void>
  /** Chat input: a slash command, one Bilinç → Eylem turn, or a direct answer from a single Model box. */
  send(id: string, text: string): Promise<void>
  /** Terminal input: a slash command or an Eylem session in the workspace. */
  terminalRun(id: string, text: string): Promise<void>
  cancel(id: string): Promise<void>
  /** Applies a slash command and returns the reply shown to the user. */
  applyCommand(id: string, cmd: MindCommand): Promise<string>
  appendTerminal(id: string, line: TerminalLine): void
  clearTerminal(id: string): void
  /** Live canvas: stage change (undefined = idle; `reset` clears the thoughts for a new turn). */
  setStage(id: string, stage: MindBusy | undefined, reset?: boolean): void
  noteLine(id: string, stage: MindBusy, line: string): void
  noteThought(id: string, actor: MindActor, text: string, kind: "reason" | "dusunce"): void
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

function actorMessage(chatId: string, actor: MindActor, ref: string, phase: MindModel["mode"], createdAt: number): Message {
  const { providerId, modelId } = parseModelRef(ref)
  return { id: newId("msg"), chatId, role: "assistant", content: "", blocks: [{ type: "mind-actor", actor, modelRef: ref, phase }], providerId: providerId as ProviderId, modelId, streaming: true, createdAt }
}

function systemMessage(chatId: string, content: string): Message {
  return { id: newId("msg"), chatId, role: "system", content, blocks: [], createdAt: Date.now() }
}

/** Apply a composition to the model's compiled fields (pure). */
function applyComposition(m: MindModel, c: MindComposition): MindModel {
  const bilinc = c.kind === "pair" ? c.bilinc! : c.kind === "single" ? { modelRef: c.single!.modelRef, effort: c.single!.effort } : { modelRef: "" }
  const eylem = c.kind === "pair" ? c.eylem! : c.kind === "single" ? { modelRef: c.single!.modelRef, effort: c.single!.effort } : { modelRef: "" }
  const prompt = c.gateway
  return { ...m, bilinc, eylem, tools: c.tools, workspace: c.workspace, gateway: { prompt, profile: prompt.trim() ? interpretGateway(prompt) : undefined } }
}

export const useMindStore = create<MindState>((set, get) => ({
  models: [],
  busy: {},
  running: {},
  activity: {},
  terminal: {},
  terminalVersion: {},
  setStage(id, stage, reset) {
    const cur = get().activity[id] ?? EMPTY_ACTIVITY
    set({ busy: { ...get().busy, [id]: stage }, activity: { ...get().activity, [id]: { ...cur, stage, since: stage ? Date.now() : cur.since, thoughts: reset ? [] : cur.thoughts } } })
  },
  noteLine(id, stage, line) {
    const cur = get().activity[id] ?? EMPTY_ACTIVITY
    const text = line.replace(/\s+/g, " ").trim().slice(0, 160)
    if (!text) return
    set({ activity: { ...get().activity, [id]: { ...cur, last: { ...cur.last, [stage]: text } } } })
  },
  noteThought(id, actor, text, kind) {
    const cur = get().activity[id] ?? EMPTY_ACTIVITY
    const t = text.trim()
    if (!t) return
    set({ activity: { ...get().activity, [id]: { ...cur, thoughts: [...cur.thoughts, { actor, text: t.slice(0, 600), kind, at: Date.now() }].slice(-THOUGHTS_CAP) } } })
    get().appendTerminal(id, { ts: Date.now(), stream: "system", text: `[${actor}] 💭 ${t.replace(/\s+/g, " ").slice(0, 300)}` })
  },
  async load() {
    const backend = await getBackend()
    // Rows written before the canvas (2026-10-08 morning) carry compiled fields only: seed their canvas from them.
    const models = (await backend.db.mindModels.list())
      .map((m) => (m.graph?.nodes?.length ? m : { ...m, graph: seedGraph(() => newId("mn"), { bilinc: m.bilinc?.modelRef, eylem: m.eylem?.modelRef, workspace: m.workspace }) }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    set({ models })
  },
  async create(name, refs) {
    const now = Date.now()
    const n = get().models.length + 1
    const model = { ...newMindModel({ id: newId("mind"), name: name?.trim() || `Mind ${n}`, now }), graph: seedGraph(() => newId("mn"), refs) }
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
  addNode(id, type, x, y, data) {
    const model = get().byId(id)
    if (!model) return undefined
    const node: MindNode = { id: newId("mn"), type, x, y, data: { ...defaultNodeData(type), ...(data as object) } as MindNodeData }
    void get().update(id, (m) => ({ ...m, graph: { ...m.graph, nodes: [...m.graph.nodes, node] } }))
    return node
  },
  updateNode(id, nodeId, patch) {
    void get().update(id, (m) => ({ ...m, graph: { ...m.graph, nodes: m.graph.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch, data: { ...n.data, ...(patch.data ?? {}) } as MindNodeData } : n)) } }))
  },
  removeNode(id, nodeId) {
    void get().update(id, (m) => ({ ...m, graph: { ...m.graph, nodes: m.graph.nodes.filter((n) => n.id !== nodeId), edges: m.graph.edges.filter((e) => e.from !== nodeId && e.to !== nodeId) } }))
  },
  addEdge(id, from, to) {
    const model = get().byId(id)
    if (!model) return null
    if (validateMindEdge(model.graph, from, to)) return null
    const edge = { id: newId("me"), from, to }
    void get().update(id, (m) => ({ ...m, graph: { ...m.graph, edges: [...m.graph.edges, edge] } }))
    return edge.id
  },
  removeEdge(id, edgeId) {
    void get().update(id, (m) => ({ ...m, graph: { ...m.graph, edges: m.graph.edges.filter((e) => e.id !== edgeId) } }))
  },
  compile(id) {
    const model = get().byId(id)
    if (!model) return undefined
    const c = composeMind(model)
    const next = applyComposition(model, c)
    // Only touch the store when something changed (the compile runs before every turn).
    if (JSON.stringify([next.bilinc, next.eylem, next.tools, next.workspace, next.gateway.prompt]) !== JSON.stringify([model.bilinc, model.eylem, model.tools, model.workspace, model.gateway.prompt])) {
      void get().update(id, next)
    }
    return c
  },
  async start(id) {
    const c = get().compile(id)
    const model = get().byId(id)
    if (!model || !c) return false
    if (c.kind === "none") {
      useNotifyStore.getState().push("error", "Tuvalde Model kutusu yok: sağ tık → Model")
      return false
    }
    const halves: Array<[string, string]> = c.kind === "pair" ? [["Bilinç", c.bilinc!.modelRef], ["Eylem", c.eylem!.modelRef]] : [["Model", c.single!.modelRef]]
    for (const [label, ref] of halves) {
      if (!isAvailable(ref)) {
        useNotifyStore.getState().push("error", `${label}: ${ref || "—"} kurulu/etkin bir CLI modeli değil`)
        return false
      }
    }
    let chatId = model.chatId
    if (!chatId || !useChatsStore.getState().byId(chatId)) {
      const { providerId, modelId } = parseModelRef(halves[0]![1])
      const chat = await useChatsStore.getState().create({ kind: "mind", providerId: providerId as ProviderId, modelId, title: model.name, repoPath: c.workspace, gatewayPrompt: c.gateway || undefined })
      chatId = chat.id
    } else await useChatsStore.getState().loadMessages(chatId)
    // Start adds the Canlı Hafıza box so the user sees what the mind writes down.
    const live = model.graph.nodes.find((n) => n.type === "live")
    const graph = live ? model.graph : { ...model.graph, nodes: [...model.graph.nodes, { id: newId("mn"), type: "live" as const, x: 900, y: 150, data: { type: "live" as const } }] }
    await get().update(id, (m) => ({ ...m, status: "started", startedAt: Date.now(), chatId, graph }))
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
    const content = text.trim()
    if (!get().byId(id) || !content) return
    const chats = useChatsStore.getState()
    const cmd = parseMindCommand(content)
    if (cmd) {
      const reply = await get().applyCommand(id, cmd)
      const chatId = get().byId(id)?.chatId
      if (chatId) await chats.putMessage(systemMessage(chatId, reply))
      return
    }
    const c = get().compile(id)
    const model = get().byId(id)!
    if (model.status !== "started" || !model.chatId || !c || c.kind === "none") {
      useNotifyStore.getState().push("info", "Önce Start'a bas: tuvaldeki model henüz kurulmadı")
      return
    }
    if (get().busy[id]) {
      useNotifyStore.getState().push("info", "Model meşgul: önceki tur bitsin ya da iptal et")
      return
    }
    const chatId = model.chatId
    const backend = await getBackend()
    // Ortak bağlam: what both halves (and the terminal) said so far, before this message — the same block for everyone.
    await chats.loadMessages(chatId)
    const shared = sharedContext(useChatsStore.getState().messages[chatId] ?? [])
    await chats.putMessage({ id: newId("msg"), chatId, role: "user", content, blocks: [], createdAt: Date.now() })
    const memory = get().memoryOf(id)
    const thinkAloud = hasThinking(model.graph)
    const finish = () => {
      const running = { ...get().running }
      delete running[id]
      set({ running })
      get().setStage(id, undefined)
    }

    // A lone Model box: the model answers directly (how a model is tested without a run).
    if (c.kind === "single") {
      const ref = c.single!.modelRef
      const live = actorMessage(chatId, "tek", ref, model.mode, Date.now())
      void chats.putMessage(live, false)
      get().setStage(id, "tek", true)
      const run = runSingle(
        backend,
        {
          runId: `mind:tek:${id}:${Date.now()}`,
          modelRef: ref,
          prompt: tekBrief(model, ref, memory, content, shared, thinkAloud),
          cwd: model.workspace,
          readOnly: !model.tools.files,
          network: model.tools.network,
          resumeSessionId: model.sessions.bilinc,
          timeoutSecs: TEK_TIMEOUT,
          effort: clampEffort(parseModelRef(ref).providerId as ProviderId, c.single!.effort),
          onDelta: (t) => {
            live.content += t
            void chats.putMessage({ ...live }, false)
          },
          onReasoning: (s) => get().noteThought(id, "tek", s, "reason"),
        },
        (line, stream) => {
          get().noteLine(id, "tek", line)
          get().appendTerminal(id, { ts: Date.now(), stream, text: `[tek] ${line}` })
        },
      )
      set({ running: { ...get().running, [id]: { cancel: run.cancel } } })
      try {
        const r = await run.done
        const { thought, rest } = r.ok ? parseDusunce(r.text) : { thought: undefined, rest: r.text }
        if (thought) get().noteThought(id, "tek", thought, "dusunce")
        await chats.putMessage({ ...live, content: rest || live.content, error: r.error, streaming: false, usage: { inputTokens: 0, outputTokens: 0, totalTokens: r.tokens } })
        await get().update(id, (m) => ({ ...m, sessions: { ...m.sessions, bilinc: r.sessionId ?? m.sessions.bilinc }, tokens: (m.tokens ?? 0) + r.tokens }))
      } catch (e) {
        reportError(e, "Mind")
      } finally {
        finish()
      }
      return
    }

    const live: Partial<Record<MindActor, Message>> = {}
    const turn = runMindTurn(
      backend,
      model,
      content,
      memory,
      {
      onStart: (stage) => {
        get().setStage(id, stage, stage === "bilinc")
        if (stage === "memory") return
        const m = actorMessage(chatId, stage, stage === "bilinc" ? model.bilinc.modelRef : model.eylem.modelRef, model.mode, Date.now())
        live[stage] = m
        void chats.putMessage(m, false)
      },
      onDelta: (actor, t) => {
        const m = live[actor]
        if (!m) return
        m.content += t
        void chats.putMessage({ ...m }, false)
      },
      onLine: (stage, line, stream) => {
        get().noteLine(id, stage, line)
        get().appendTerminal(id, { ts: Date.now(), stream, text: `[${stage}] ${line}` })
      },
      onThinking: (actor, text, kind) => get().noteThought(id, actor, text, kind),
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
      },
      { shared, thinkAloud },
    )
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
      finish()
    }
  },
  async terminalRun(id, text) {
    const content = text.trim()
    if (!get().byId(id) || !content) return
    const cmd = parseMindCommand(content)
    if (cmd) {
      const reply = await get().applyCommand(id, cmd)
      get().appendTerminal(id, { ts: Date.now(), stream: "system", text: reply })
      return
    }
    const c = get().compile(id)
    const model = get().byId(id)!
    if (model.status !== "started" || !c || c.kind === "none") {
      get().appendTerminal(id, { ts: Date.now(), stream: "system", text: "Önce Start'a bas" })
      return
    }
    if (get().busy[id]) {
      get().appendTerminal(id, { ts: Date.now(), stream: "system", text: "meşgul — bekle ya da iptal et" })
      return
    }
    const backend = await getBackend()
    get().setStage(id, "terminal")
    get().appendTerminal(id, { ts: Date.now(), stream: "system", text: `$ ${content}` })
    const ref = model.eylem.modelRef
    const chats = useChatsStore.getState()
    if (model.chatId) await chats.loadMessages(model.chatId)
    const shared = model.chatId ? sharedContext(useChatsStore.getState().messages[model.chatId] ?? []) : ""
    const run = runSingle(
      backend,
      {
        runId: `mind:term:${id}:${Date.now()}`,
        modelRef: ref,
        prompt: terminalBrief(model, get().memoryOf(id), content, shared),
        cwd: model.workspace,
        readOnly: !model.tools.files,
        network: model.tools.network,
        resumeSessionId: model.sessions.terminal,
        timeoutSecs: TERMINAL_TIMEOUT,
        effort: clampEffort(parseModelRef(ref).providerId as ProviderId, model.eylem.effort),
      },
      (line, stream) => {
        get().noteLine(id, "terminal", line)
        get().appendTerminal(id, { ts: Date.now(), stream, text: `[terminal] ${line}` })
      },
    )
    set({ running: { ...get().running, [id]: { cancel: run.cancel } } })
    try {
      const r = await run.done
      if (!r.ok) get().appendTerminal(id, { ts: Date.now(), stream: "stderr", text: r.error ?? "failed" })
      await get().update(id, (m) => ({ ...m, sessions: { ...m.sessions, terminal: r.sessionId ?? m.sessions.terminal }, tokens: (m.tokens ?? 0) + r.tokens }))
      // The chat halves learn what the terminal did through a note in the shared transcript.
      if (model.chatId && r.ok) await chats.putMessage(systemMessage(model.chatId, terminalNote(content, r.text)))
      if (model.workspace && model.tools.shell) await backend.projectSweep(model.workspace).catch(() => 0)
    } catch (e) {
      reportError(e, "Mind terminal")
    } finally {
      const running = { ...get().running }
      delete running[id]
      set({ running })
      get().setStage(id, undefined)
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
        // Change the Model box of that role on the canvas (or add one), then recompile.
        const box = model.graph.nodes.find((n) => n.data.type === "model" && n.data.role === cmd.actor)
        if (box) get().updateNode(id, box.id, { data: { modelRef: cmd.modelRef } })
        else {
          const pos = nextPosition(model.graph, 2)
          get().addNode(id, "model", pos.x, pos.y, { type: "model", role: cmd.actor, modelRef: cmd.modelRef })
        }
        await get().update(id, (m) => ({ ...m, sessions: { ...m.sessions, [cmd.actor]: undefined, ...(cmd.actor === "eylem" ? { terminal: undefined } : {}) } }))
        get().compile(id)
        return `${cmd.actor === "bilinc" ? "Bilinç" : "Eylem"} → ${cmd.modelRef} (yeni oturum)`
      }
      case "plan":
        await get().update(id, { mode: "plan" })
        return "Plan modu: Bilinç yalnız plan yazar, Eylem çalışmaz (/act ile geri dön)"
      case "act":
        await get().update(id, { mode: "act" })
        return "Eylem modu: Bilinç gerekirse Eylem'e devreder"
      case "effort": {
        for (const n of model.graph.nodes) {
          if (n.data.type !== "model") continue
          if (!cmd.actor || n.data.role === cmd.actor || (cmd.actor && n.data.role === "tek")) get().updateNode(id, n.id, { data: { effort: cmd.effort } })
        }
        get().compile(id)
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
        return "sıfırlandı: sohbet ve canlı hafıza silindi, depo ve tuval kaldı"
      case "durum": {
        const c = get().compile(id)
        const m = get().byId(id)!
        const mem = get().memoryOf(id)
        return [
          `${m.name} · ${m.status === "started" ? "çalışıyor" : "taslak"} · mod ${m.mode} · tuval ${m.graph.nodes.length} kutu / ${m.graph.edges.length} kablo · ${c?.kind === "pair" ? "Bilinç+Eylem" : c?.kind === "single" ? "tek model" : "model yok"}`,
          `Bilinç ${m.bilinc.modelRef || "—"}${m.bilinc.effort ? ` (${m.bilinc.effort})` : ""}${m.sessions.bilinc ? " · oturum var" : ""}`,
          `Eylem ${m.eylem.modelRef || "—"}${m.eylem.effort ? ` (${m.eylem.effort})` : ""}${m.sessions.eylem ? " · oturum var" : ""}`,
          `araçlar: ${Object.entries(m.tools).filter(([, v]) => v).map(([k]) => k).join(", ") || "yok"}`,
          `klasör: ${m.workspace ?? "—"} · hafıza ${mem.length} (${mem.filter((e) => e.pinned).length} depo) · Σ ${m.tokens ?? 0} token`,
          ...(c?.warnings.length ? [`▲ ${c.warnings.join(", ")}`] : []),
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
