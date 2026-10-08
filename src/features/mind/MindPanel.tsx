import * as React from "react"
import { FolderOpen, Pin, PinOff, Trash2, X } from "lucide-react"
import type { Effort, MemoryEntry, MindActor, MindModel, MindNode, MindTools, ProviderId } from "@/domain"
import { parseModelRef } from "@/domain"
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
import { PROVIDERS } from "@/providers/registry"
import { useProvidersStore } from "@/stores/providers"
import { ActorChip } from "./ActorChip"

const EFFORTS: Array<Effort | ""> = ["", "low", "medium", "high", "xhigh"]
const ROLES: MindActor[] = ["bilinc", "eylem", "tek"]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[10px] tracking-[0.14em] text-text-3 uppercase">
      {label}
      <div className="normal-case tracking-normal">{children}</div>
    </label>
  )
}

/** Memory rows shared by the depot and the live box: pin ↔ depot, forget. */
function MemoryRows({ entries }: { entries: MemoryEntry[] }) {
  const t = useT()
  const remove = useMemoryStore((s) => s.remove)
  const update = useMemoryStore((s) => s.update)
  return (
    <div className="flex max-h-[320px] flex-col gap-1 overflow-auto" data-testid="mind-memory-rows">
      {entries.length === 0 && <div className="py-3 text-center text-[11px] text-text-3">{t("mind.depotEmpty")}</div>}
      {entries.map((e) => (
        <div key={e.id} className="group flex items-start gap-2 rounded-none border border-line bg-ink-2 px-2 py-1 text-[11px]">
          <span className="mt-1 size-1.5 shrink-0 rounded-full" style={{ background: e.pinned ? "var(--mind)" : "var(--text-3)" }} />
          <span className="min-w-0 flex-1 break-words">{e.body}</span>
          <span className="mono shrink-0 text-[9px] text-text-3">{e.pinned ? t("mind.depot") : e.source}</span>
          <button type="button" onClick={() => void update(e.id, { pinned: !e.pinned })} className="text-text-3 hover:text-mind" aria-label={e.pinned ? t("mind.fromDepot") : t("mind.toDepot")}>{e.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}</button>
          <button type="button" onClick={() => void remove(e.id)} className="text-text-3 hover:text-danger" aria-label={t("mind.forget")}><Trash2 className="size-3" /></button>
        </div>
      ))}
    </div>
  )
}

/** Right-hand editor of the selected box (the Blueprint side panel, Mind flavoured). */
export function MindPanel({ model, node, onClose }: { model: MindModel; node: MindNode; onClose: () => void }) {
  const t = useT()
  const updateNode = useMindStore((s) => s.updateNode)
  const removeNode = useMindStore((s) => s.removeNode)
  const entries = useMemoryStore((s) => s.entries)
  const add = useMemoryStore((s) => s.add)
  const modelByRef = useProvidersStore((s) => s.modelByRef)
  const thoughts = useMindStore((s) => s.activity[model.id]?.thoughts)
  const [draft, setDraft] = React.useState("")
  const d = node.data
  const mine = entries.filter((e) => e.layer === "mind" && e.scopeId === model.id)
  const title = d.type === "model" ? t(`mind.role.${d.role}` as never) : t(`mind.node.${d.type}` as never)

  let body: React.ReactNode
  if (d.type === "model") {
    const { providerId, modelId } = parseModelRef(d.modelRef || "codex:")
    body = (
      <>
        <Field label={t("mind.roleLabel")}>
          <div className="flex gap-1" data-testid="mind-role-switch">
            {ROLES.map((r) => (
              <button key={r} type="button" onClick={() => updateNode(model.id, node.id, { data: { role: r } })} className={r === d.role ? "h-7 flex-1 rounded-none border border-mind bg-mind/10 text-[11px] text-mind" : "h-7 flex-1 rounded-none border border-line text-[11px] text-text-2 hover:text-text-1"}>
                {t(`mind.role.${r}` as never)}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-text-3">{t(`mind.roleHint.${d.role}` as never)}</div>
        </Field>
        <Field label={t("common.model")}>
          <div data-testid="mind-model-picker">
            <ModelPicker providerId={(providerId || "codex") as ProviderId} modelId={modelId} onChange={(pid, mid) => updateNode(model.id, node.id, { data: { modelRef: `${pid}:${mid}` } })} />
          </div>
        </Field>
        <Field label={t("mind.effort")}>
          <select value={d.effort ?? ""} onChange={(e) => updateNode(model.id, node.id, { data: { effort: (e.target.value || undefined) as Effort | undefined } })} className="mono h-7 w-full rounded-none border border-line bg-ink-2 px-1 text-[11px] text-text-1">
            {EFFORTS.map((e) => <option key={e} value={e}>{e || t("mind.auto")}</option>)}
          </select>
        </Field>
        <div className="pt-1"><ActorChip actor={d.role} modelRef={d.modelRef || undefined} size="xs" /></div>
        {d.modelRef && (() => {
          // Model card: what Silent knows about this model (provider capabilities + catalog row) and what can be switched OFF for this box.
          const pid = d.modelRef.split(":")[0] as ProviderId
          const info = PROVIDERS[pid]
          const row = modelByRef(d.modelRef)
          if (!info) return null
          const caps = info.capabilities
          const efforts = info.efforts?.length ? info.efforts.join(" · ") : "—"
          const offable: Array<[keyof MindTools, string, boolean]> = [
            ["browser", t("mind.tool.browser"), Boolean(caps.browser)],
            ["network", t("mind.tool.network"), true],
            ["files", t("mind.tool.files"), true],
            ["shell", t("mind.tool.shell"), true],
            ["image", t("mind.tool.image"), Boolean(caps.image)],
          ]
          return (
            <Field label={t("mind.modelCard")}>
              <div className="rounded-none border border-line bg-ink-2 p-2 text-[11px]" data-testid="mind-model-card">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <span><span className="text-text-3">{t("common.cli")}:</span> {info.name}</span>
                  {row && <span><span className="text-text-3">{t("mind.tier")}:</span> {row.tier}</span>}
                  <span><span className="text-text-3">{t("mind.effort")}:</span> <span className="mono">{efforts}</span></span>
                  {row?.meta?.context && <span><span className="text-text-3">ctx:</span> {row.meta.context}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {([["planner", caps.planner], ["browser", caps.browser], ["image", Boolean(caps.image)], ["resume", caps.resume], ["readOnly", caps.readOnlySandbox]] as Array<[string, boolean]>).map(([k, ok]) => (
                    <span key={k} className={ok ? "rounded-none border border-success/50 px-1 text-[10px] text-success" : "rounded-none border border-line/50 px-1 text-[10px] text-text-3 line-through"}>{t(`mind.cap.${k}` as never)}</span>
                  ))}
                </div>
                <div className="mt-2 text-[10px] tracking-[0.14em] text-text-3 uppercase">{t("mind.offTitle")}</div>
                <div className="mt-1 flex flex-col gap-1">
                  {offable.filter(([, , can]) => can).map(([key, label]) => {
                    const off = Boolean(d.off?.[key])
                    return (
                      <label key={key} className="flex items-center justify-between rounded-none border border-line bg-ink-1 px-2 py-1 text-[11px]">
                        <span className={off ? "text-text-3 line-through" : ""}>{label}</span>
                        <Switch checked={!off} onCheckedChange={(v) => updateNode(model.id, node.id, { data: { off: { ...(d.off ?? {}), [key]: !v } } })} data-testid={`mind-off-${key}`} />
                      </label>
                    )
                  })}
                </div>
                <div className="mt-1 text-[10px] text-text-3">{t("mind.offHint")}</div>
              </div>
            </Field>
          )
        })()}
      </>
    )
  } else if (d.type === "thinking") {
    const list = thoughts ?? []
    body = (
      <>
        <div className="text-[11px] text-text-3">{t("mind.thinkingHint")}</div>
        <div className="flex max-h-[420px] flex-col gap-1 overflow-auto" data-testid="mind-thought-rows">
          {list.length === 0 && <div className="py-3 text-center text-[11px] text-text-3">{t("mind.thinkingEmpty")}</div>}
          {list.map((x) => (
            <div key={x.at + x.text} className={x.kind === "dusunce" ? "rounded-none border border-mind/50 bg-ink-2 px-2 py-1 text-[11px] whitespace-pre-wrap" : "mono rounded-none border border-line bg-ink-2 px-2 py-1 text-[10px] text-text-3"}>
              <span className="mr-1 text-[9px] text-mind uppercase">{x.actor}</span>{x.text}
            </div>
          ))}
        </div>
      </>
    )
  } else if (d.type === "gateway") {
    const profile = d.prompt.trim() ? interpretGateway(d.prompt) : undefined
    body = (
      <>
        <div className="text-[11px] text-text-3">{t("mind.gatewayHint")}</div>
        <Textarea value={d.prompt} onChange={(e) => updateNode(model.id, node.id, { data: { prompt: e.target.value } })} rows={8} placeholder={t("mind.gatewayPh")} data-testid="mind-gateway-input" className="rounded-none border-line bg-ink-2 text-sm" />
        <Field label={t("mind.gatewayPreview")}>
          <pre className="mono max-h-[200px] overflow-auto rounded-none border border-line bg-ink-2 p-2 text-[11px] whitespace-pre-wrap text-text-2">{profile ? renderGatewayBrief(profile) : "—"}</pre>
        </Field>
      </>
    )
  } else if (d.type === "memory") {
    const submit = () => {
      const text = draft.trim()
      if (!text) return
      setDraft("")
      void add({ layer: "mind", scopeId: model.id, scopeLabel: model.name, tags: ["depot"], title: "", body: text, source: "user", pinned: true })
    }
    body = (
      <>
        <div className="text-[11px] text-text-3">{t("mind.depotHint")}</div>
        <div className="flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submit())} placeholder={t("mind.depotPh")} data-testid="mind-depot-input" className="rounded-none border-line bg-ink-2" />
          <NeonButton onClick={submit} disabled={!draft.trim()}>{t("common.add")}</NeonButton>
        </div>
        <MemoryRows entries={mine.filter((e) => e.pinned)} />
      </>
    )
  } else if (d.type === "tools") {
    const rows: Array<[keyof MindTools, string]> = [["browser", t("mind.tool.browser")], ["files", t("mind.tool.files")], ["shell", t("mind.tool.shell")], ["network", t("mind.tool.network")], ["image", t("mind.tool.image")]]
    const pick = async () => {
      const b = await getBackend()
      const p = await b.pickDirectory()
      if (p) updateNode(model.id, node.id, { data: { workspace: p } })
    }
    body = (
      <>
        <div className="flex flex-col gap-1.5">
          {rows.map(([key, label]) => (
            <label key={key} className="flex items-center justify-between rounded-none border border-line bg-ink-2 px-2.5 py-1.5 text-[12px]">
              {label}
              <Switch checked={d.tools[key]} onCheckedChange={(v) => updateNode(model.id, node.id, { data: { tools: { ...d.tools, [key]: v } } })} data-testid={`mind-tool-${key}`} />
            </label>
          ))}
        </div>
        <Field label={t("mind.workspace")}>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="mono min-w-0 flex-1 truncate">{d.workspace ?? t("mind.noFolder")}</span>
            <NeonButton variant="outline" onClick={() => void pick()} data-testid="mind-pick-folder"><FolderOpen className="size-3.5" />{t("mind.pickFolder")}</NeonButton>
          </div>
        </Field>
      </>
    )
  } else {
    body = (
      <>
        <div className="text-[11px] text-text-3">{t("mind.liveHint")}</div>
        <MemoryRows entries={[...mine].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt)} />
      </>
    )
  }

  return (
    <aside className="flex w-[320px] shrink-0 flex-col gap-3 overflow-auto border-l border-line bg-ink-1 p-3" data-testid="mind-panel">
      <div className="flex items-center gap-2">
        <div className="font-heading text-[11px] font-semibold tracking-[0.18em] uppercase">{title}</div>
        <button type="button" onClick={onClose} className="ml-auto text-text-3 hover:text-text-1" aria-label={t("common.close")}><X className="size-4" /></button>
      </div>
      {body}
      {d.type !== "live" && (
        <button type="button" onClick={() => { removeNode(model.id, node.id); onClose() }} className="mt-auto flex items-center justify-center gap-1.5 rounded-none border border-line py-1.5 text-[11px] text-text-3 hover:border-danger hover:text-danger" data-testid="mind-node-delete">
          <Trash2 className="size-3" />{t("mind.deleteNode")}
        </button>
      )}
    </aside>
  )
}
