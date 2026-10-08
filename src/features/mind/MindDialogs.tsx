import * as React from "react"
import { FolderOpen, Pin, PinOff, Trash2 } from "lucide-react"
import type { Effort, MemoryEntry, MindModel, MindTools, ProviderId } from "@/domain"
import { parseModelRef } from "@/domain"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { NeonButton } from "@/design-system"
import { ModelPicker } from "@/features/chat/ModelPicker"
import { interpretGateway, renderGatewayBrief } from "@/engine/gateway"
import { useMindStore } from "@/stores/mind"
import { useMemoryStore } from "@/stores/memory"
import { getBackend } from "@/services"
import { useT } from "@/i18n"
import { ActorChip } from "./ActorChip"

const EFFORTS: Array<Effort | ""> = ["", "low", "medium", "high", "xhigh"]

function Shell({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={wide ? "max-w-[780px] rounded-none border-line bg-ink-1" : "max-w-[560px] rounded-none border-line bg-ink-1"}>
        <DialogHeader><DialogTitle className="font-heading text-sm tracking-[0.18em] uppercase">{title}</DialogTitle></DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/** Model: which CLI model is the mind and which one acts, with an effort per half. */
export function ModelDialog({ model, open, onClose }: { model: MindModel; open: boolean; onClose: () => void }) {
  const t = useT()
  const update = useMindStore((s) => s.update)
  const half = (actor: "bilinc" | "eylem") => {
    const role = model[actor]
    const { providerId, modelId } = parseModelRef(role.modelRef || "codex:")
    return (
      <div className="flex flex-col gap-2 rounded-none border border-line p-3" data-testid={`mind-half-${actor}`}>
        <ActorChip actor={actor} modelRef={role.modelRef || undefined} />
        <div className="text-[11px] text-text-3">{actor === "bilinc" ? t("mind.bilincHint") : t("mind.eylemHint")}</div>
        <div className="flex flex-wrap items-center gap-2">
          <ModelPicker providerId={(providerId || "codex") as ProviderId} modelId={modelId} onChange={(pid, mid) => void update(model.id, (m) => ({ ...m, [actor]: { ...m[actor], modelRef: `${pid}:${mid}` }, sessions: { ...m.sessions, [actor]: undefined, ...(actor === "eylem" ? { terminal: undefined } : {}) } }))} />
          <label className="flex items-center gap-1 text-[11px] text-text-3">
            {t("mind.effort")}
            <select value={role.effort ?? ""} onChange={(e) => void update(model.id, (m) => ({ ...m, [actor]: { ...m[actor], effort: (e.target.value || undefined) as Effort | undefined } }))} className="mono h-7 rounded-none border border-line bg-ink-2 px-1 text-[11px] text-text-1">
              {EFFORTS.map((e) => <option key={e} value={e}>{e || t("mind.auto")}</option>)}
            </select>
          </label>
        </div>
      </div>
    )
  }
  return (
    <Shell open={open} onClose={onClose} title={t("mind.modelBtn")} wide>
      <div className="grid grid-cols-2 gap-3">{half("bilinc")}{half("eylem")}</div>
    </Shell>
  )
}

/** Gateway: the main mind's prompt and the profile Silent derives from it. */
export function GatewayDialog({ model, open, onClose }: { model: MindModel; open: boolean; onClose: () => void }) {
  const t = useT()
  const update = useMindStore((s) => s.update)
  const [draft, setDraft] = React.useState(model.gateway.prompt)
  const profile = React.useMemo(() => (draft.trim() ? interpretGateway(draft) : undefined), [draft])
  const save = () => {
    void update(model.id, (m) => ({ ...m, gateway: { prompt: draft, profile: draft.trim() ? interpretGateway(draft) : undefined } }))
    onClose()
  }
  return (
    <Shell open={open} onClose={onClose} title={t("mind.gatewayTitle")} wide>
      <div className="text-[11px] text-text-3">{t("mind.gatewayHint")}</div>
      <div className="grid grid-cols-2 gap-3">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} placeholder={t("mind.gatewayPh")} data-testid="mind-gateway-input" className="rounded-none border-line bg-ink-2 text-sm" />
        <div className="rounded-none border border-line bg-ink-2 p-3">
          <div className="mb-1 text-[10px] tracking-[0.16em] text-text-3 uppercase">{t("mind.gatewayPreview")}</div>
          <pre className="mono max-h-[280px] overflow-auto text-[11px] whitespace-pre-wrap text-text-2">{profile ? renderGatewayBrief(profile) : "—"}</pre>
        </div>
      </div>
      <div className="flex justify-end"><NeonButton onClick={save} data-testid="mind-gateway-save">{t("common.save")}</NeonButton></div>
    </Shell>
  )
}

/** Hafıza deposu: pinned entries the model always carries (Reset keeps them). */
export function DepotDialog({ model, open, onClose }: { model: MindModel; open: boolean; onClose: () => void }) {
  const t = useT()
  const entries = useMemoryStore((s) => s.entries)
  const add = useMemoryStore((s) => s.add)
  const remove = useMemoryStore((s) => s.remove)
  const [draft, setDraft] = React.useState("")
  const depot = entries.filter((e) => e.layer === "mind" && e.scopeId === model.id && e.pinned)
  const submit = () => {
    const body = draft.trim()
    if (!body) return
    setDraft("")
    void add({ layer: "mind", scopeId: model.id, scopeLabel: model.name, tags: ["depot"], title: "", body, source: "user", pinned: true })
  }
  return (
    <Shell open={open} onClose={onClose} title={t("mind.depotTitle")}>
      <div className="text-[11px] text-text-3">{t("mind.depotHint")}</div>
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submit())} placeholder={t("mind.depotPh")} data-testid="mind-depot-input" className="rounded-none border-line bg-ink-2" />
        <NeonButton onClick={submit} disabled={!draft.trim()}>{t("common.add")}</NeonButton>
      </div>
      <div className="flex max-h-[320px] flex-col gap-1 overflow-auto" data-testid="mind-depot-list">
        {depot.length === 0 && <div className="py-4 text-center text-[11px] text-text-3">{t("mind.depotEmpty")}</div>}
        {depot.map((e) => (
          <div key={e.id} className="flex items-center gap-2 rounded-none border border-line bg-ink-2 px-2 py-1 text-[12px]">
            <Pin className="size-3 shrink-0 text-mind" />
            <span className="min-w-0 flex-1 truncate">{e.body}</span>
            <button type="button" onClick={() => void remove(e.id)} className="text-text-3 hover:text-danger" aria-label={t("common.delete")}><Trash2 className="size-3" /></button>
          </div>
        ))}
      </div>
    </Shell>
  )
}

/** Araçlar: what Eylem may touch, and where it works. */
export function ToolsDialog({ model, open, onClose }: { model: MindModel; open: boolean; onClose: () => void }) {
  const t = useT()
  const update = useMindStore((s) => s.update)
  const rows: Array<[keyof MindTools, string]> = [["browser", t("mind.toolBrowser")], ["files", t("mind.toolFiles")], ["shell", t("mind.toolShell")], ["network", t("mind.toolNetwork")], ["image", t("mind.toolImage")]]
  const pick = async () => {
    const b = await getBackend()
    const p = await b.pickDirectory()
    if (p) await update(model.id, (m) => ({ ...m, workspace: p, sessions: {} }))
  }
  return (
    <Shell open={open} onClose={onClose} title={t("mind.toolsTitle")}>
      <div className="flex flex-col gap-2">
        {rows.map(([key, label]) => (
          <label key={key} className="flex items-center justify-between rounded-none border border-line bg-ink-2 px-3 py-2 text-[12px]">
            {label}
            <Switch checked={model.tools[key]} onCheckedChange={(v) => void update(model.id, (m) => ({ ...m, tools: { ...m.tools, [key]: v } }))} data-testid={`mind-tool-${key}`} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-text-3">{t("mind.workspace")}:</span>
        <span className="mono min-w-0 flex-1 truncate">{model.workspace ?? t("mind.noFolder")}</span>
        <NeonButton variant="outline" onClick={() => void pick()} data-testid="mind-pick-folder"><FolderOpen className="size-3.5" />{t("mind.pickFolder")}</NeonButton>
      </div>
    </Shell>
  )
}

/** Canlı hafıza: what the model has written to its memory so far (auto + /hatirla), with the depot on top. */
export function LiveMemory({ model }: { model: MindModel }) {
  const t = useT()
  const entries = useMemoryStore((s) => s.entries)
  const remove = useMemoryStore((s) => s.remove)
  const update = useMemoryStore((s) => s.update)
  const mine = entries.filter((e) => e.layer === "mind" && e.scopeId === model.id).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt)
  const row = (e: MemoryEntry) => (
    <div key={e.id} className="group flex items-start gap-2 rounded-none border border-line bg-ink-1 px-2 py-1 text-[11px] animate-in fade-in">
      <span className="mt-1 size-1.5 shrink-0 rounded-full" style={{ background: e.pinned ? "var(--mind)" : "var(--text-3)" }} />
      <span className="min-w-0 flex-1 break-words">{e.body}</span>
      <span className="mono shrink-0 text-[9px] text-text-3">{e.pinned ? t("mind.depot") : e.source}</span>
      <button type="button" onClick={() => void update(e.id, { pinned: !e.pinned })} className="text-text-3 opacity-0 group-hover:opacity-100 hover:text-mind" aria-label={e.pinned ? t("mind.fromDepot") : t("mind.toDepot")}>{e.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}</button>
      <button type="button" onClick={() => void remove(e.id)} className="text-text-3 opacity-0 group-hover:opacity-100 hover:text-danger" aria-label={t("mind.forget")}><Trash2 className="size-3" /></button>
    </div>
  )
  return (
    <div className="flex min-h-0 flex-col gap-1 rounded-none border border-mind/40 bg-ink-2 p-2" data-testid="mind-live-memory">
      <div className="flex items-center gap-2 text-[10px] tracking-[0.16em] text-mind uppercase"><span className="size-1.5 animate-pulse-soft rounded-full bg-mind" />{t("mind.liveMemory")}<span className="mono ml-auto text-text-3">{mine.length}</span></div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
        {mine.length === 0 && <div className="py-3 text-center text-[11px] text-text-3">{t("mind.liveEmpty")}</div>}
        {mine.map(row)}
      </div>
    </div>
  )
}
