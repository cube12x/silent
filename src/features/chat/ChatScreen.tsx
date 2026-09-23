import * as React from "react"
import { useNavigate, useParams } from "react-router"
import { cn } from "cn"
import { ArrowUp, Bot, FolderGit2, Square, Trash2, Terminal, CheckCircle2, XCircle, Loader2, Files, Copy, Check } from "lucide-react"
import { useChatsStore } from "@/stores/chats"
import { useAgentsStore } from "@/stores/agents"
import { useUiStore } from "@/stores/ui"
import { EmptyState, MarkdownView, ModelLogo, ModelTag, NeonButton, TacticalChip } from "@/design-system"
import type { Message, MessageBlock } from "@/domain"
import { MODEL_BY_ID } from "@/engine/capabilities"
import { formatDuration, formatRelative, formatTokens, shortPath } from "@/lib/format"
import { Textarea } from "@/components/ui/textarea"

function Block({ block }: { block: MessageBlock }) {
  if (block.type === "task-card") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-line bg-ink-0/70 px-3 py-2">
        <span className="mt-0.5 text-text-3">{block.status === "running" ? <Loader2 className="size-3.5 animate-spin text-cyan" /> : block.status === "done" ? <CheckCircle2 className="size-3.5 text-success" /> : <XCircle className="size-3.5 text-danger" />}</span>
        <div className="min-w-0 flex-1">
          <div className="mono truncate text-xs text-text-1"><Terminal className="mr-1 inline size-3 text-text-3" />{block.command ?? block.title}</div>
          {block.detail && <pre className="mono mt-1 max-h-24 overflow-auto text-[11px] whitespace-pre-wrap text-text-3">{block.detail}</pre>}
        </div>
      </div>
    )
  }
  if (block.type === "execution-summary") {
    return (
      <div className="rounded-lg border border-cyan/30 bg-cyan/[0.04] p-3">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-[0.16em] text-cyan uppercase">{block.title}<span className="ml-auto mono normal-case tracking-normal text-text-3">{formatDuration(block.durationMs)}{block.tokens ? ` · ${formatTokens(block.tokens)} tok` : ""}</span></div>
        <div className="grid grid-cols-2 gap-3 text-[11px]">
          <div>
            <div className="mb-1 text-text-3">Files touched</div>
            <ul className="mono flex flex-col gap-0.5 text-text-2">{block.filesTouched.map((f) => <li key={f} className="truncate">{f}</li>)}</ul>
          </div>
          <div>
            <div className="mb-1 text-text-3">Commands</div>
            <ul className="mono flex flex-col gap-0.5 text-text-2">{block.commands.map((c) => <li key={c} className="truncate">$ {c}</li>)}</ul>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-[10px] tracking-wider text-text-3 uppercase"><Files className="size-3" />{block.label}</span>
      {block.items.map((it) => <TacticalChip key={it} size="xs" mono>{it}</TacticalChip>)}
    </div>
  )
}

function Bubble({ m }: { m: Message }) {
  const [copied, setCopied] = React.useState(false)
  const user = m.role === "user"
  const model = m.modelId ? MODEL_BY_ID[m.modelId] : undefined
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* noop */ }
  }
  return (
    <div className={cn("group flex gap-3", user && "flex-row-reverse")}>
      <div className="mt-0.5 shrink-0">{user ? <span className="flex size-7 items-center justify-center rounded-lg border border-line bg-ink-3 text-[10px] font-semibold text-text-2">YOU</span> : <ModelLogo modelId={m.modelId ?? ""} size={14} />}</div>
      <div className={cn("flex min-w-0 max-w-[min(860px,85%)] flex-col gap-2", user && "items-end")}>
        <div className={cn("flex items-center gap-2 text-[10px] text-text-3", user && "flex-row-reverse")}>
          <span className="font-medium text-text-2">{user ? "You" : model?.displayName ?? "Assistant"}</span>
          <span>{formatRelative(m.createdAt)}</span>
          {m.usage && <span className="mono">{formatTokens(m.usage.totalTokens)} tok</span>}
          {!user && !m.streaming && <button type="button" onClick={copy} className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 hover:text-cyan">{copied ? <Check className="size-3" /> : <Copy className="size-3" />}</button>}
        </div>
        <div className={cn("rounded-xl border px-4 py-3", user ? "border-cyan/30 bg-cyan/[0.07] text-text-1" : "panel border-line")}>
          {user ? <div className="text-sm whitespace-pre-wrap">{m.content}</div> : m.content ? <MarkdownView content={m.content} /> : m.streaming ? <div className="flex items-center gap-2 text-xs text-text-3"><Loader2 className="size-3.5 animate-spin text-cyan" />{model?.executable ? "Codex is working…" : "thinking…"}</div> : null}
          {m.streaming && m.content && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-blink bg-cyan align-middle" />}
          {m.error && <div className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">{m.error}</div>}
        </div>
        {m.blocks.length > 0 && <div className="flex w-full flex-col gap-2">{m.blocks.map((b, i) => <Block key={i} block={b} />)}</div>}
      </div>
    </div>
  )
}

export function ChatScreen() {
  const { chatId } = useParams()
  const navigate = useNavigate()
  const chat = useChatsStore((s) => s.byId(chatId))
  const messages = useChatsStore((s) => (chatId ? s.messages[chatId] : undefined))
  const streaming = useChatsStore((s) => (chatId ? !!s.streaming[chatId] : false))
  const loadMessages = useChatsStore((s) => s.loadMessages)
  const send = useChatsStore((s) => s.send)
  const cancel = useChatsStore((s) => s.cancel)
  const remove = useChatsStore((s) => s.remove)
  const agent = useAgentsStore((s) => s.byId(chat?.repoAgentId))
  const openNewSession = useUiStore((s) => s.openNewSession)
  const [draft, setDraft] = React.useState("")
  const bottomRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (chatId) void loadMessages(chatId)
  }, [chatId, loadMessages])
  const lastLen = messages?.[messages.length - 1]?.content.length ?? 0
  const count = messages?.length ?? 0
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [count, lastLen])

  if (!chat) return <div className="p-6"><EmptyState title="Chat not found" action={<NeonButton onClick={() => openNewSession({ kind: "standard" })}>New chat</NeonButton>} /></div>
  const model = MODEL_BY_ID[chat.modelId]

  const submit = () => {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft("")
    void send(chat.id, text)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-ink-1/60 px-6 py-3 backdrop-blur">
        <ModelLogo modelId={chat.modelId} size={16} />
        <div className="min-w-0">
          <div className="truncate font-heading text-sm font-semibold">{chat.title}</div>
          <div className="flex items-center gap-2 text-[11px] text-text-3">
            <ModelTag modelId={chat.modelId} size="xs" />
            {model?.executable ? <TacticalChip size="xs" tone="cyan">codex exec · live</TacticalChip> : <TacticalChip size="xs">simulated</TacticalChip>}
            {agent && <button type="button" onClick={() => navigate(`/agents/${agent.id}`)} className="flex items-center gap-1 hover:text-cyan"><Bot className="size-3" />{agent.name}</button>}
            {chat.repoPath && <span className="mono flex items-center gap-1"><FolderGit2 className="size-3" />{shortPath(chat.repoPath)}</span>}
            {chat.codexThreadId && <span className="mono">thread {chat.codexThreadId.slice(0, 10)}…</span>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => { void remove(chat.id); navigate("/") }} className="flex size-7 items-center justify-center rounded-md text-text-3 hover:bg-danger/10 hover:text-danger" aria-label="Delete chat"><Trash2 className="size-4" /></button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
          {(!messages || messages.length === 0) && (
            <EmptyState
              icon={<Terminal />}
              title={model?.executable ? "Codex is standing by." : `${model?.displayName ?? "Model"} is standing by (simulated).`}
              description={chat.gatewayProfile ? `Gateway: ${chat.gatewayProfile.summary}` : "Ask anything. Attach a repo agent to make the chat repo-aware."}
            />
          )}
          {messages?.map((m) => <Bubble key={m.id} m={m} />)}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-line bg-ink-1/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto max-w-[1100px]">
          <div className={cn("panel flex items-end gap-2 rounded-xl p-2 pl-3 transition-shadow focus-within:shadow-glow")}>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              rows={1}
              placeholder={model?.executable ? `Message Codex${chat.repoPath ? ` about ${shortPath(chat.repoPath, 1)}` : ""}… (Enter to send)` : `Message ${model?.displayName ?? "model"}…`}
              className="max-h-48 min-h-[40px] flex-1 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
            />
            {streaming ? (
              <NeonButton variant="outline" size="icon" onClick={() => cancel(chat.id)} aria-label="Stop"><Square /></NeonButton>
            ) : (
              <NeonButton size="icon" onClick={submit} disabled={!draft.trim()} aria-label="Send"><ArrowUp /></NeonButton>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-3 px-1 text-[10px] text-text-3">
            <span>Shift+Enter for newline</span>
            {model?.executable && <span className="mono">codex -a never -s workspace-write exec --json{chat.codexThreadId ? " resume" : ""}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
