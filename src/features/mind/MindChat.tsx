import * as React from "react"
import { cn } from "cn"
import { ArrowUp, Loader2, Square } from "lucide-react"
import type { Message, MindModel } from "@/domain"
import { MarkdownView } from "@/design-system/tactical/MarkdownView"
import { NeonButton } from "@/design-system"
import { Textarea } from "@/components/ui/textarea"
import { useChatsStore } from "@/stores/chats"
import { useMindStore } from "@/stores/mind"
import { formatRelative, formatTokens } from "@/lib/format"
import { useT } from "@/i18n"
import { ActorChip } from "./ActorChip"

const EMPTY: Message[] = []

function actorOf(m: Message): { actor: "bilinc" | "eylem" | "tek" | "memory"; modelRef: string } | undefined {
  const b = m.blocks.find((x) => x.type === "mind-actor")
  return b && b.type === "mind-actor" ? { actor: b.actor, modelRef: b.modelRef } : undefined
}

function Bubble({ m, previous, youLabel, workingLabel, handoffLabel }: { m: Message; previous?: Message; youLabel: string; workingLabel: string; handoffLabel: string }) {
  if (m.role === "system") return <div className="mx-auto max-w-[80%] whitespace-pre-wrap rounded-none border border-line bg-ink-2 px-3 py-1.5 text-[11px] text-text-2">{m.content}</div>
  const user = m.role === "user"
  const actor = actorOf(m)
  const handoff = actor?.actor === "eylem" && actorOf(previous ?? m)?.actor === "bilinc"
  return (
    <>
      {handoff && <div className="flex items-center gap-2 text-[10px] text-text-3"><span className="h-px flex-1 bg-line" />↪ {handoffLabel}<span className="h-px flex-1 bg-line" /></div>}
      <div className={cn("group flex flex-col gap-1.5", user ? "items-end" : "items-start")}>
        <div className={cn("flex items-center gap-2 text-[10px] text-text-3", user && "flex-row-reverse")}>
          {user ? <span className="font-medium text-text-2">{youLabel}</span> : actor ? <ActorChip actor={actor.actor} modelRef={actor.modelRef} size="xs" /> : <span className="text-text-2">{m.providerId}</span>}
          <span>{formatRelative(m.createdAt)}</span>
          {m.usage && m.usage.totalTokens > 0 && <span className="mono">{formatTokens(m.usage.totalTokens)} tok</span>}
        </div>
        <div className={cn("max-w-[min(900px,92%)] rounded-none border px-4 py-3", user ? "border-text-1/40 bg-ink-3 text-text-1" : "border-line bg-ink-1")}>
          {user ? <div className="text-sm whitespace-pre-wrap">{m.content}</div> : m.content ? <MarkdownView content={m.content} /> : m.streaming ? <div className="flex items-center gap-2 text-xs text-text-3"><Loader2 className="size-3.5 animate-spin text-mind" />{workingLabel}</div> : null}
          {m.streaming && m.content && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-blink bg-mind align-middle" />}
          {m.error && <div className="mt-2 rounded-none border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">{m.error}</div>}
        </div>
      </div>
    </>
  )
}

export function MindChat({ model }: { model: MindModel }) {
  const t = useT()
  const chatId = model.chatId
  const messages = useChatsStore((s) => (chatId ? s.messages[chatId] : undefined)) ?? EMPTY
  const loadMessages = useChatsStore((s) => s.loadMessages)
  const busy = useMindStore((s) => s.busy[model.id])
  const send = useMindStore((s) => s.send)
  const cancel = useMindStore((s) => s.cancel)
  const [draft, setDraft] = React.useState("")
  const bottomRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (chatId) void loadMessages(chatId)
  }, [chatId, loadMessages])
  const lastLen = messages[messages.length - 1]?.content.length ?? 0
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length, lastLen])
  const started = model.status === "started"
  const turnBusy = busy === "bilinc" || busy === "eylem" || busy === "memory"
  const status = busy === "bilinc" ? t("mind.thinking") : busy === "eylem" ? t("mind.acting") : busy === "memory" ? t("mind.remembering") : busy === "terminal" ? t("mind.termBusy") : undefined
  const submit = () => {
    const text = draft.trim()
    if (!text || turnBusy) return
    setDraft("")
    void send(model.id, text)
  }
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mind-chat">
      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
          {messages.length === 0 && <div className="py-10 text-center text-[12px] text-text-3">{started ? t("mind.slashHelp") : t("mind.notStarted")}</div>}
          {messages.map((m, i) => <Bubble key={m.id} m={m} previous={messages[i - 1]} youLabel={t("mind.you")} workingLabel={status ?? ""} handoffLabel={t("mind.handoff")} />)}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="border-t border-line bg-ink-1/80 px-5 py-3">
        <div className="mx-auto max-w-[1000px]">
          <div className="flex items-end gap-2 rounded-none border border-line bg-ink-2 p-2 pl-3">
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
              placeholder={t("mind.chatPh", { name: model.name })}
              data-testid="mind-chat-input"
              className="max-h-48 min-h-[40px] flex-1 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
            />
            {turnBusy ? <NeonButton variant="outline" size="icon" onClick={() => void cancel(model.id)} aria-label={t("mind.stop")}><Square /></NeonButton> : <NeonButton size="icon" onClick={submit} disabled={!draft.trim()} aria-label={t("mind.send")} data-testid="mind-chat-send"><ArrowUp /></NeonButton>}
          </div>
          <div className="mt-1.5 flex items-center gap-3 px-1 text-[10px] text-text-3">
            <span className="truncate">{t("mind.slashHelp")}</span>
            {status && <span className="ml-auto flex items-center gap-1 text-mind"><Loader2 className="size-3 animate-spin" />{status}</span>}
            <span className={cn("mono", !status && "ml-auto")}>{model.mode === "plan" ? t("mind.planMode") : t("mind.actMode")}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
