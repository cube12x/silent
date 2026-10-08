import { create } from "zustand"
import type { Chat, ChatKind, Message, MessageBlock, ProviderId, RuntimeEvent, TokenUsage } from "@/domain"
import { interpretGateway, renderGatewayBrief } from "@/engine/gateway"
import { getBackend } from "@/services"
import type { RunHandle } from "@/services/backend"
import { newId } from "@/lib/ids"

export interface CreateChatInput {
  kind: ChatKind
  providerId: ProviderId
  modelId: string
  title?: string
  repoAgentId?: string
  repoPath?: string
  gatewayPrompt?: string
  runId?: string
}

interface ChatsState {
  chats: Chat[]
  messages: Record<string, Message[]>
  streaming: Record<string, { cancel: () => void }>
  load(): Promise<void>
  loadMessages(chatId: string): Promise<void>
  create(input: CreateChatInput): Promise<Chat>
  update(id: string, patch: Partial<Chat>): Promise<void>
  remove(id: string): Promise<void>
  /** Switch CLI/model; a new CLI session starts on the next message. */
  setModel(id: string, providerId: ProviderId, modelId: string): Promise<void>
  clearMessages(id: string): Promise<void>
  /** MindMirror: insert or replace one message (memory + DB); the Mind store streams its two halves through this. */
  putMessage(message: Message, persist?: boolean): Promise<void>
  /** MindMirror reset: drop every message of the chat in memory and in the DB; the chat row stays. */
  purgeMessages(chatId: string): Promise<void>
  send(chatId: string, content: string, sandbox?: "read-only" | "workspace-write"): Promise<void>
  cancel(chatId: string): void
  byId(id: string | undefined): Chat | undefined
}

function titleFrom(content: string): string {
  const t = content.replace(/\s+/g, " ").trim()
  return t.length > 48 ? `${t.slice(0, 45)}…` : t || "…"
}

export const useChatsStore = create<ChatsState>((set, get) => ({
  chats: [],
  messages: {},
  streaming: {},
  async load() {
    const backend = await getBackend()
    set({ chats: (await backend.db.chats.list()).sort((a, b) => b.updatedAt - a.updatedAt) })
  },
  async loadMessages(chatId) {
    if (get().messages[chatId]) return
    const backend = await getBackend()
    set({ messages: { ...get().messages, [chatId]: await backend.db.messages.listByChat(chatId) } })
  },
  async create(input) {
    const now = Date.now()
    const chat: Chat = {
      id: newId("chat"),
      title: input.title?.trim() || "…",
      kind: input.kind,
      providerId: input.providerId,
      modelId: input.modelId,
      repoAgentId: input.repoAgentId,
      repoPath: input.repoPath,
      gatewayPrompt: input.gatewayPrompt,
      gatewayProfile: input.gatewayPrompt ? interpretGateway(input.gatewayPrompt) : undefined,
      runId: input.runId,
      createdAt: now,
      updatedAt: now,
    }
    set({ chats: [chat, ...get().chats], messages: { ...get().messages, [chat.id]: [] } })
    const backend = await getBackend()
    await backend.db.chats.upsert(chat)
    return chat
  },
  async update(id, patch) {
    const chat = get().chats.find((c) => c.id === id)
    if (!chat) return
    const next = { ...chat, ...patch, updatedAt: Date.now() }
    set({ chats: get().chats.map((c) => (c.id === id ? next : c)) })
    const backend = await getBackend()
    await backend.db.chats.upsert(next)
  },
  async remove(id) {
    get().cancel(id)
    const messages = { ...get().messages }
    delete messages[id]
    set({ chats: get().chats.filter((c) => c.id !== id), messages })
    const backend = await getBackend()
    await backend.db.chats.delete(id)
  },
  async setModel(id, providerId, modelId) {
    const chat = get().chats.find((c) => c.id === id)
    if (!chat) return
    const providerChanged = chat.providerId !== providerId
    await get().update(id, { providerId, modelId, sessionId: providerChanged ? undefined : chat.sessionId })
  },
  async clearMessages(id) {
    set({ messages: { ...get().messages, [id]: [] } })
    await get().update(id, { sessionId: undefined })
  },
  async putMessage(message, persist = true) {
    const list = get().messages[message.chatId] ?? []
    const next = list.some((m) => m.id === message.id) ? list.map((m) => (m.id === message.id ? message : m)) : [...list, message]
    set({ messages: { ...get().messages, [message.chatId]: next } })
    if (!persist) return
    const backend = await getBackend()
    await backend.db.messages.upsert(message)
  },
  async purgeMessages(chatId) {
    set({ messages: { ...get().messages, [chatId]: [] } })
    const backend = await getBackend()
    await backend.db.messages.deleteByChat(chatId)
    await get().update(chatId, { sessionId: undefined })
  },
  cancel(chatId) {
    get().streaming[chatId]?.cancel()
  },
  async send(chatId, content, sandbox = "workspace-write") {
    const chat = get().chats.find((c) => c.id === chatId)
    if (!chat || get().streaming[chatId]) return
    const backend = await getBackend()
    const now = Date.now()
    const user: Message = { id: newId("msg"), chatId, role: "user", content, blocks: [], createdAt: now }
    const assistant: Message = { id: newId("msg"), chatId, role: "assistant", content: "", blocks: [], providerId: chat.providerId, modelId: chat.modelId, streaming: true, createdAt: now + 1 }
    const isFirst = (get().messages[chatId] ?? []).length === 0
    const upsertMsg = (m: Message) => set({ messages: { ...get().messages, [chatId]: (get().messages[chatId] ?? []).map((x) => (x.id === m.id ? m : x)) } })
    set({ messages: { ...get().messages, [chatId]: [...(get().messages[chatId] ?? []), user, assistant] } })
    await backend.db.messages.upsert(user)
    if (isFirst && (chat.title === "…" || !chat.title)) await get().update(chatId, { title: titleFrom(content) })

    let text = ""
    let deltaText = ""
    const blocks: MessageBlock[] = []
    let usage: TokenUsage | undefined
    let costUsd: number | undefined
    let error: string | undefined
    let sessionId = chat.sessionId
    const pendingCards = new Map<string, number>()
    const flush = (streaming: boolean) => upsertMsg({ ...assistant, content: text || deltaText, blocks: [...blocks], usage, costUsd, error, streaming })

    const finish = async () => {
      const streaming = { ...get().streaming }
      delete streaming[chatId]
      set({ streaming })
      const finalText = text || deltaText
      flush(false)
      await backend.db.messages.upsert({ ...assistant, content: finalText, blocks, usage, costUsd, error, streaming: false })
      await get().update(chatId, { sessionId })
      set({ chats: [...get().chats].sort((a, b) => b.updatedAt - a.updatedAt) })
    }

    const onEvent = (e: RuntimeEvent) => {
      switch (e.type) {
        case "sessionStarted":
          sessionId = e.data.sessionId
          break
        case "textDelta":
          deltaText += e.data.text
          flush(true)
          break
        case "agentMessage":
          // Full messages win over deltas; several messages per turn are joined.
          text = text.trim() ? `${text.trim()}\n\n${e.data.text}` : e.data.text
          deltaText = ""
          flush(true)
          break
        case "commandStarted":
          blocks.push({ type: "task-card", title: e.data.command, status: "running", command: e.data.command })
          pendingCards.set(e.data.command, blocks.length - 1)
          flush(true)
          break
        case "commandCompleted": {
          const i = pendingCards.get(e.data.command) ?? blocks.findIndex((b) => b.type === "task-card" && b.status === "running")
          if (i >= 0) blocks[i] = { type: "task-card", title: e.data.command, status: e.data.exitCode === 0 || e.data.exitCode === null ? "done" : "failed", command: e.data.command, detail: e.data.outputTail.split("\n").slice(-4).join("\n") }
          flush(true)
          break
        }
        case "fileChanged": {
          const existing = blocks.find((b): b is Extract<MessageBlock, { type: "context" }> => b.type === "context" && b.label === "files")
          if (existing) {
            if (!existing.items.includes(e.data.path)) existing.items.push(e.data.path)
          } else blocks.push({ type: "context", label: "files", items: [e.data.path] })
          flush(true)
          break
        }
        case "usage":
          usage = { inputTokens: e.data.inputTokens, outputTokens: e.data.outputTokens, totalTokens: e.data.totalTokens, cachedInputTokens: e.data.cachedInputTokens }
          break
        case "cost":
          costUsd = e.data.usd
          break
        case "failed":
          if (e.data.code !== "cancelled") error = e.data.message
          break
        case "stderr":
          if (!text && !deltaText && /error|failed|denied|not logged|unauthori/i.test(e.data.line)) error = e.data.line
          break
        case "exited":
          if (e.data.code && e.data.code !== 0 && !error) error = `${chat.providerId} exited with code ${e.data.code}`
          void finish()
      }
    }

    let handle: RunHandle | undefined
    try {
      const brief = chat.gatewayProfile ? `${renderGatewayBrief(chat.gatewayProfile)}\n\n${content}` : content
      handle = await backend.cliStart(
        { runId: `chat:${chatId}:${user.id}`, providerId: chat.providerId, modelId: chat.modelId || undefined, prompt: brief, cwd: chat.repoPath, sandbox, network: sandbox === "workspace-write", resumeSessionId: chat.sessionId, ephemeral: false },
        onEvent,
      )
      set({ streaming: { ...get().streaming, [chatId]: { cancel: () => void handle?.cancel() } } })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      await finish()
    }
  },
  byId(id) {
    return id ? get().chats.find((c) => c.id === id) : undefined
  },
}))
