import * as React from "react"
import { useNavigate, useParams } from "react-router"
import { cn } from "cn"
import { ArrowUp, Bot, FolderGit2, Square, Trash2, Terminal, CheckCircle2, XCircle, Loader2, Files, Copy, Check, FolderOpen, X } from "lucide-react"
import { useChatsStore } from "@/stores/chats"
import { useAgentsStore } from "@/stores/agents"
import { useProvidersStore } from "@/stores/providers"
import { useUiStore } from "@/stores/ui"
import { EmptyState, MarkdownView, ModelLogo, NeonButton, TacticalChip } from "@/design-system"
import type { Message, MessageBlock, ProviderId } from "@/domain"
import { PROVIDER_IDS, modelRef } from "@/domain"
import { PROVIDERS } from "@/providers/registry"
import { formatDuration, formatRelative, formatTokens, formatUsd, shortPath } from "@/lib/format"
import { Textarea } from "@/components/ui/textarea"
import { getBackend } from "@/services"
import { useT } from "@/i18n"
import { ModelPicker } from "./ModelPicker"
import { SilentMark } from "@/app/SilentMark"

function Block({ block, filesLabel }: { block: MessageBlock; filesLabel: string }) {
  if (block.type === "task-card") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-line bg-ink-0/70 px-3 py-2">
        <span className="mt-0.5">{block.status === "running" ? <Loader2 className="size-3.5 animate-spin text-cyan" /> : block.status === "done" ? <CheckCircle2 className="size-3.5 text-success" /> : <XCircle className="size-3.5 text-danger" />}</span>
        <div className="min-w-0 flex-1">
          <div className="mono truncate text-xs text-text-1"><Terminal className="mr-1 inline size-3 text-text-3" />{block.command ?? block.title}</div>
          {block.detail && <pre className="mono mt-1 max-h-24 overflow-auto text-[11px] whitespace-pre-wrap text-text-3">{block.detail}</pre>}
        </div>
      </div>
    )
  }
  if (block.type === "execution-summary") {
    return <div className="rounded-lg border border-cyan/30 bg-cyan/[0.04] p-3 text-[11px] text-text-2">{block.title} · {formatDuration(block.durationMs)}</div>
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-[10px] tracking-wider text-text-3 uppercase"><Files className="size-3" />{block.label === "files" ? filesLabel : block.label}</span>
      {block.items.map((it) => <TacticalChip key={it} size="xs" mono>{it}</TacticalChip>)}
    </div>
  )
}

function Bubble({ m, youLabel, workingLabel, filesLabel }: { m: Message; youLabel: string; workingLabel: string; filesLabel: string }) {
  const [copied, setCopied] = React.useState(false)
  const user = m.role === "user"
  const info = m.providerId ? PROVIDERS[m.providerId] : undefined
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* noop */ }
  }
  return (
    <div className={cn("group flex gap-3", user && "flex-row-reverse")}>
      <div className="mt-0.5 shrink-0">{user ? <span className="flex size-7 items-center justify-center rounded-lg border border-line bg-ink-3 text-[9px] font-semibold text-text-2">{youLabel.slice(0, 3).toUpperCase()}</span> : <ModelLogo modelRef={modelRef(m.providerId ?? "codex", m.modelId ?? "")} size={14} />}</div>
      <div className={cn("flex min-w-0 max-w-[min(900px,88%)] flex-col gap-2", user && "items-end")}>
        <div className={cn("flex items-center gap-2 text-[10px] text-text-3", user && "flex-row-reverse")}>
          <span className="font-medium text-text-2">{user ? youLabel : `${info?.name ?? m.providerId}${m.modelId ? ` · ${m.modelId}` : ""}`}</span>
          <span>{formatRelative(m.createdAt)}</span>
          {m.usage && <span className="mono">{formatTokens(m.usage.totalTokens)} tok</span>}
          {m.costUsd !== undefined && m.costUsd > 0 && <span className="mono">{formatUsd(m.costUsd)}</span>}
          {!user && !m.streaming && <button type="button" onClick={copy} className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 hover:text-cyan">{copied ? <Check className="size-3" /> : <Copy className="size-3" />}</button>}
        </div>
        <div className={cn("rounded-xl border px-4 py-3", user ? "border-cyan/30 bg-cyan/[0.07] text-text-1" : "panel border-line")}>
          {user ? <div className="text-sm whitespace-pre-wrap">{m.content}</div> : m.content ? <MarkdownView content={m.content} /> : m.streaming ? <div className="flex items-center gap-2 text-xs text-text-3"><Loader2 className="size-3.5 animate-spin text-cyan" />{workingLabel}</div> : null}
          {m.streaming && m.content && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-blink bg-cyan align-middle" />}
          {m.error && <div className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">{m.error}</div>}
        </div>
        {m.blocks.length > 0 && <div className="flex w-full flex-col gap-2">{m.blocks.map((b, i) => <Block key={i} block={b} filesLabel={filesLabel} />)}</div>}
      </div>
    </div>
  )
}

export function ChatScreen() {
  const t = useT()
  const { chatId } = useParams()
  const navigate = useNavigate()
  const chat = useChatsStore((s) => s.byId(chatId))
  const chats = useChatsStore((s) => s.chats)
  const messages = useChatsStore((s) => (chatId ? s.messages[chatId] : undefined))
  const streaming = useChatsStore((s) => (chatId ? !!s.streaming[chatId] : false))
  const loadMessages = useChatsStore((s) => s.loadMessages)
  const send = useChatsStore((s) => s.send)
  const cancel = useChatsStore((s) => s.cancel)
  const remove = useChatsStore((s) => s.remove)
  const update = useChatsStore((s) => s.update)
  const setModel = useChatsStore((s) => s.setModel)
  const clearMessages = useChatsStore((s) => s.clearMessages)
  const agent = useAgentsStore((s) => s.byId(chat?.repoAgentId))
  const providers = useProvidersStore((s) => s.providers)
  const openNewSession = useUiStore((s) => s.openNewSession)
  const [draft, setDraft] = React.useState("")
  const [notice, setNotice] = React.useState<string | null>(null)
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const anyCli = PROVIDER_IDS.some((id) => providers[id].installed)

  React.useEffect(() => {
    if (chatId) void loadMessages(chatId)
  }, [chatId, loadMessages])
  React.useEffect(() => {
    if (!chatId && chats.length) navigate(`/chat/${chats[0].id}`, { replace: true })
  }, [chatId, chats, navigate])
  const lastLen = messages?.[messages.length - 1]?.content.length ?? 0
  const count = messages?.length ?? 0
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [count, lastLen])

  if (!chat) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={<SilentMark size={28} />} title={anyCli ? t("chat.empty") : t("chat.emptyNoCli")} action={anyCli ? <NeonButton onClick={() => openNewSession({ kind: "standard" })}>{t("nav.newChat")}</NeonButton> : <NeonButton onClick={() => navigate("/settings")}>{t("nav.settings")}</NeonButton>} />
      </div>
    )
  }
  const info = PROVIDERS[chat.providerId]
  const modelName = chat.modelId || info.name

  const runSlash = (text: string): boolean => {
    const m = text.match(/^\/(model|cli|clear)\s*(.*)$/i)
    if (!m) return false
    const cmd = m[1].toLowerCase()
    const arg = m[2].trim()
    if (cmd === "clear") {
      void clearMessages(chat.id)
      return true
    }
    if (cmd === "cli") {
      const pid = arg.toLowerCase() as ProviderId
      if (PROVIDER_IDS.includes(pid) && providers[pid].installed) {
        const first = providers[pid].models.find((x) => x.isDefault) ?? providers[pid].models[0]
        void setModel(chat.id, pid, first?.id ?? "")
        setNotice(t("chat.modelSwitched", { model: `${PROVIDERS[pid].name} · ${first?.displayName ?? ""}` }))
      } else setNotice(t("chat.modelUnknown", { model: arg }))
      return true
    }
    // /model <id> or /model <cli>:<id> — unknown ids are accepted as custom (the CLI decides).
    const [maybeCli, ...rest] = arg.split(":")
    const pid = rest.length && PROVIDER_IDS.includes(maybeCli as ProviderId) ? (maybeCli as ProviderId) : chat.providerId
    const id = rest.length ? rest.join(":") : arg
    const known = providers[pid].models.find((x) => x.id === id || x.displayName.toLowerCase() === id.toLowerCase())
    if (!id) return true
    void setModel(chat.id, pid, known?.id ?? id)
    setNotice(t("chat.modelSwitched", { model: `${PROVIDERS[pid].name} · ${known?.displayName ?? id}` }))
    return true
  }

  const submit = () => {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft("")
    if (runSlash(text)) return
    setNotice(null)
    void send(chat.id, text, agent && !agent.permissions.write ? "read-only" : "workspace-write")
  }

  const pickRepo = async () => {
    const backend = await getBackend()
    const p = await backend.pickDirectory()
    if (p) await update(chat.id, { repoPath: p, sessionId: undefined })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-ink-1/60 px-5 py-2.5 backdrop-blur">
        <ModelPicker providerId={chat.providerId} modelId={chat.modelId} onChange={(pid, mid) => void setModel(chat.id, pid, mid)} />
        <TacticalChip size="xs" tone={chat.sessionId ? "cyan" : "neutral"}>{chat.sessionId ? t("chat.resumes") : t("chat.newSession")}</TacticalChip>
        {agent && <button type="button" onClick={() => navigate(`/agents/${agent.id}`)} className="flex items-center gap-1 text-[11px] text-text-2 hover:text-cyan"><Bot className="size-3" />{agent.name}</button>}
        {chat.repoPath ? (
          <span className="mono flex items-center gap-1 text-[11px] text-text-2"><FolderGit2 className="size-3" />{shortPath(chat.repoPath)}{!agent && <button type="button" onClick={() => void update(chat.id, { repoPath: undefined, sessionId: undefined })} className="text-text-3 hover:text-danger" aria-label={t("chat.detachRepo")}><X className="size-3" /></button>}</span>
        ) : (
          <button type="button" onClick={pickRepo} className="flex items-center gap-1 text-[11px] text-text-3 hover:text-cyan"><FolderOpen className="size-3" />{t("chat.attachRepo")}</button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => { void (async () => { const b = await getBackend(); if (await b.confirm(t("chat.deleteConfirm"))) { void remove(chat.id); navigate("/") } })() }} className="flex size-7 items-center justify-center rounded-md text-text-3 hover:bg-danger/10 hover:text-danger" aria-label={t("common.delete")}><Trash2 className="size-4" /></button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-6">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
          {(!messages || messages.length === 0) && <EmptyState icon={<Terminal />} title={`${info.name} · ${modelName}`} description={chat.gatewayProfile ? chat.gatewayProfile.summary : t("chat.slashHelp")} />}
          {messages?.map((m) => <Bubble key={m.id} m={m} youLabel={t("chat.you")} workingLabel={t("chat.working", { model: modelName })} filesLabel={t("chat.filesTouched")} />)}
          {notice && <div className="mx-auto rounded-md border border-line bg-ink-2 px-3 py-1 text-[11px] text-text-2">{notice}</div>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-line bg-ink-1/80 px-5 py-3 backdrop-blur">
        <div className="mx-auto max-w-[1100px]">
          <div className="panel flex items-end gap-2 rounded-xl p-2 pl-3 transition-shadow ">
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
              placeholder={t("chat.placeholder", { model: modelName })}
              className="max-h-48 min-h-[40px] flex-1 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
            />
            {streaming ? <NeonButton variant="outline" size="icon" onClick={() => cancel(chat.id)} aria-label={t("chat.stop")}><Square /></NeonButton> : <NeonButton size="icon" onClick={submit} disabled={!draft.trim()} aria-label={t("chat.send")}><ArrowUp /></NeonButton>}
          </div>
          <div className="mt-1.5 flex items-center gap-3 px-1 text-[10px] text-text-3"><span>{t("chat.slashHelp")}</span><span className="mono ml-auto">{info.binary}{chat.sessionId ? " · resume" : ""}</span></div>
        </div>
      </div>
    </div>
  )
}
