import { create } from "zustand"
import type { Chat, ChatKind, Message, MessageBlock, RuntimeEvent, TokenUsage } from "@/domain"
import { interpretGateway } from "@/engine/gateway"
import { MODEL_BY_ID } from "@/engine/capabilities"
import { getBackend } from "@/services"
import type { CodexRunHandle } from "@/services/backend"
import { simulateReply } from "@/services/chatReply"
import { newId } from "@/lib/ids"

export interface CreateChatInput {
  kind: ChatKind
  modelId: string
  title?: string
  repoAgentId?: string
  repoPath?: string
  gatewayPrompt?: string
}

interface ChatsState {
  chats: Chat[]
  messages: Record<string, Message[]>
  streaming: Record<string, { cancel: () => void }>
  load(): Promise<void>
  loadMessages(chatId: string): Promise<void>
  create(input: CreateChatInput): Promise<Chat>
  rename(id: string, title: string): Promise<void>
  remove(id: string): Promise<void>
  send(chatId: string, content: string): Promise<void>
  cancel(chatId: string): void
  byId(id: string | undefined): Chat | undefined
}

function titleFrom(content: string): string {
  const t = content.replace(/\s+/g, " ").trim()
  return t.length > 48 ? `${t.slice(0, 45)}…` : t || "New chat"
}

export const useChatsStore = create<ChatsState>((set, get) => ({
  chats: [],
  messages: {},
  streaming: {},
  async load() {
    const backend = await getBackend()
    set({ chats: await backend.db.chats.list() })
  },
  async loadMessages(chatId) {
    if (get().messages[chatId]) return
    const backend = await getBackend()
    const list = await backend.db.messages.listByChat(chatId)
    set({ messages: { ...get().messages, [chatId]: list } })
  },
  async create(input) {
    const now = Date.now()
    const chat: Chat = {
      id: newId("chat"),
      title: input.title?.trim() || (input.kind === "repo-agent" ? "Repo agent chat" : "New chat"),
      kind: input.kind,
      modelId: input.modelId,
      repoAgentId: input.repoAgentId,
      repoPath: input.repoPath,
      gatewayPrompt: input.gatewayPrompt,
      gatewayProfile: input.gatewayPrompt ? interpretGateway(input.gatewayPrompt) : undefined,
      createdAt: now,
      updatedAt: now,
    }
    set({ chats: [chat, ...get().chats], messages: { ...get().messages, [chat.id]: [] } })
    const backend = await getBackend()
    await backend.db.chats.upsert(chat)
    return chat
  },
  async rename(id, title) {
    const chat = get().chats.find((c) => c.id === id)
    if (!chat) return
    const next = { ...chat, title, updatedAt: Date.now() }
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
  cancel(chatId) {
    get().streaming[chatId]?.cancel()
  },
  async send(chatId, content) {
    const chat = get().chats.find((c) => c.id === chatId)
    if (!chat || get().streaming[chatId]) return
    const backend = await getBackend()
    const now = Date.now()
    const user: Message = { id: newId("msg"), chatId, role: "user", content, blocks: [], createdAt: now }
    const assistant: Message = { id: newId("msg"), chatId, role: "assistant", content: "", blocks: [], modelId: chat.modelId, streaming: true, createdAt: now + 1 }
    const isFirst = (get().messages[chatId] ?? []).length === 0
    const upsertMsg = (m: Message) => set({ messages: { ...get().messages, [chatId]: (get().messages[chatId] ?? []).map((x) => (x.id === m.id ? m : x)) } })
    set({ messages: { ...get().messages, [chatId]: [...(get().messages[chatId] ?? []), user, assistant] } })
    await backend.db.messages.upsert(user)
    if (isFirst) await get().rename(chatId, titleFrom(content))

    let text = ""
    const blocks: MessageBlock[] = []
    let usage: TokenUsage | undefined
    let error: string | undefined
    const flush = (streaming: boolean) => upsertMsg({ ...assistant, content: text, blocks: [...blocks], usage, error, streaming })

    const finish = async () => {
      const streaming = { ...get().streaming }
      delete streaming[chatId]
      set({ streaming })
      flush(false)
      await backend.db.messages.upsert({ ...assistant, content: text, blocks, usage, error, streaming: false })
      const c = get().chats.find((x) => x.id === chatId)
      if (c) {
        const next = { ...c, updatedAt: Date.now() }
        set({ chats: get().chats.map((x) => (x.id === chatId ? next : x)).sort((a, b) => b.updatedAt - a.updatedAt) })
        await backend.db.chats.upsert(next)
      }
    }

    const model = MODEL_BY_ID[chat.modelId]
    if (model?.providerId === "codex") {
      let handle: CodexRunHandle | undefined
      let threadId = chat.codexThreadId
      const pendingCards = new Map<string, number>()
      const onEvent = (e: RuntimeEvent) => {
        switch (e.type) {
          case "threadStarted":
            threadId = e.data.threadId
            break
          case "textDelta":
            text += e.data.text
            flush(true)
            break
          case "agentMessage":
            // Codex emits one agent_message per assistant turn segment; keep them all.
            text = text.trim() ? `${text.trim()}\n\n${e.data.text}` : e.data.text
            flush(true)
            break
          case "commandStarted": {
            blocks.push({ type: "task-card", title: e.data.command, status: "running", command: e.data.command })
            pendingCards.set(e.data.command, blocks.length - 1)
            flush(true)
            break
          }
          case "commandCompleted": {
            const i = pendingCards.get(e.data.command)
            if (i !== undefined) blocks[i] = { type: "task-card", title: e.data.command, status: e.data.exitCode === 0 ? "done" : "failed", command: e.data.command, detail: e.data.outputTail.split("\n").slice(-3).join("\n") }
            flush(true)
            break
          }
          case "fileChanged": {
            const existing = blocks.find((b): b is Extract<MessageBlock, { type: "context" }> => b.type === "context" && b.label === "Files touched")
            if (existing) existing.items.push(e.data.path)
            else blocks.push({ type: "context", label: "Files touched", items: [e.data.path] })
            flush(true)
            break
          }
          case "usage":
            usage = { inputTokens: e.data.inputTokens, outputTokens: e.data.outputTokens, totalTokens: e.data.totalTokens, cachedInputTokens: e.data.cachedInputTokens }
            break
          case "failed":
            if (e.data.code !== "cancelled") error = e.data.message
            break
          case "stderr":
            if (!text && /error/i.test(e.data.line)) error = e.data.line
            break
          case "exited": {
            if (e.data.code && e.data.code !== 0 && !error) error = `codex exited with code ${e.data.code}`
            if (threadId && threadId !== chat.codexThreadId) {
              const next = { ...chat, codexThreadId: threadId }
              set({ chats: get().chats.map((x) => (x.id === chatId ? next : x)) })
              void backend.db.chats.upsert(next)
            }
            void finish()
          }
        }
      }
      try {
        handle = await backend.codexStart(
          {
            runId: `chat:${chatId}:${user.id}`,
            prompt: chat.gatewayProfile ? `${chat.gatewayPrompt}\n\n${content}` : content,
            cwd: chat.repoPath,
            sandbox: "workspace-write",
            resumeThreadId: chat.codexThreadId,
            ephemeral: false,
            skipGitRepoCheck: true,
          },
          onEvent,
        )
        set({ streaming: { ...get().streaming, [chatId]: { cancel: () => void handle?.cancel() } } })
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        await finish()
      }
      return
    }

    const signal = { cancelled: false }
    set({ streaming: { ...get().streaming, [chatId]: { cancel: () => (signal.cancelled = true) } } })
    const result = await simulateReply(chat, content, (delta) => {
      text += delta
      flush(true)
    }, signal)
    text = result.text
    blocks.push(...result.blocks)
    usage = { inputTokens: 900 + content.length, outputTokens: Math.round(text.length / 4), totalTokens: 900 + content.length + Math.round(text.length / 4) }
    await finish()
  },
  byId(id) {
    return id ? get().chats.find((c) => c.id === id) : undefined
  },
}))
