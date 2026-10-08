import * as React from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { cn } from "cn"
import { Bot, BrainCog, Database, Eye, Hammer, Settings2, Sparkles, Wrench } from "lucide-react"
import type { MindNode, MindNodeData, ProviderId } from "@/domain"
import { ModelLogo } from "@/design-system"
import { useMemoryStore } from "@/stores/memory"
import { useMindStore, type MindBusy } from "@/stores/mind"
import { modelRefColor, modelRefShort, roleColor } from "@/engine/mind/colors"
import { PROVIDERS } from "@/providers/registry"
import { useNow } from "@/lib/useNow"
import { useT } from "@/i18n"

export type MindFlowNode = { id: string; type: string; position: { x: number; y: number }; data: { node: MindNode; warnings: string[]; modelId: string } }

const EMPTY_LAST: Partial<Record<MindBusy, string>> = {}

function Shell({ node, icon, title, children, warnings, accent, ring, target = true, source = true, testId, badge }: { node: MindNode; icon: React.ReactNode; title: string; children?: React.ReactNode; warnings: string[]; accent?: string; ring?: string; target?: boolean; source?: boolean; testId: string; badge?: React.ReactNode }) {
  const t = useT()
  return (
    <div data-testid={testId} className={cn("relative w-[220px] rounded-none border bg-ink-2 text-text-1 shadow-[0_8px_30px_rgba(0,0,0,0.35)]", ring ?? "border-line")} style={accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : undefined}>
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.16em] text-text-2 uppercase">
        <span className="[&_svg]:size-3.5">{icon}</span>
        <span className="truncate">{title}</span>
        {badge}
        {warnings.length > 0 && <span title={warnings.map((w) => t(`mind.warn.${w}` as never)).join("\n")} className="ml-auto text-warn">▲</span>}
      </div>
      <div className="px-2.5 py-2 text-xs text-text-2">{children}</div>
      {target && <Handle type="target" position={Position.Left} className="!size-2.5 !rounded-full !border !border-line !bg-ink-0" />}
      {source && <Handle type="source" position={Position.Right} className="!size-2.5 !rounded-full !border !border-text-2 !bg-text-1" />}
      {void node}
    </div>
  )
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s} sn` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** Which stage of the live activity belongs to this box. */
function stageOf(role: "bilinc" | "eylem" | "tek", stage: MindBusy | undefined): MindBusy | undefined {
  if (!stage) return undefined
  if (role === "bilinc" && stage === "bilinc") return stage
  if (role === "eylem" && (stage === "eylem" || stage === "terminal")) return stage
  if (role === "tek" && (stage === "tek" || stage === "terminal")) return stage
  return undefined
}

export function ModelNode({ data }: NodeProps<MindFlowNode>) {
  const t = useT()
  const n = data.node
  const d = n.data.type === "model" ? n.data : ({ type: "model", role: "tek", modelRef: "" } as Extract<MindNodeData, { type: "model" }>)
  const stage = useMindStore((s) => s.activity[data.modelId]?.stage)
  const since = useMindStore((s) => s.activity[data.modelId]?.since)
  const last = useMindStore((s) => s.activity[data.modelId]?.last) ?? EMPTY_LAST
  const mine = stageOf(d.role, stage)
  const now = useNow(1000, Boolean(mine))
  const lastLine = mine ? last[mine] : d.role === "bilinc" ? last.bilinc : d.role === "eylem" ? (last.eylem ?? last.terminal) : (last.tek ?? last.terminal)
  const icon = d.role === "bilinc" ? <Eye /> : d.role === "eylem" ? <Hammer /> : <Bot />
  const providerId = d.modelRef.split(":")[0] as ProviderId | undefined
  const caps = providerId ? PROVIDERS[providerId]?.capabilities : undefined
  const offCount = Object.values(d.off ?? {}).filter(Boolean).length
  return (
    <Shell
      node={n}
      icon={icon}
      title={d.title || t(`mind.role.${d.role}` as never)}
      warnings={data.warnings}
      accent={roleColor(d.role)}
      ring={mine ? "border-text-1 animate-pulse" : undefined}
      source={false}
      testId={`mind-node-model-${d.role}`}
      badge={mine ? <span className="mono ml-auto normal-case tracking-normal text-mind">{t(`mind.stage.${mine}` as never)} · {fmtElapsed(now - (since ?? now))}</span> : undefined}
    >
      <div className="flex items-center gap-2">
        {d.modelRef ? <ModelLogo modelRef={d.modelRef} size={14} /> : <Sparkles className="size-3.5 text-text-3" />}
        <span className="mono truncate text-[11px]" style={d.modelRef ? { color: modelRefColor(d.modelRef) } : undefined}>{d.modelRef ? modelRefShort(d.modelRef) : t("mind.noModelRef")}</span>
        {d.effort && <span className="ml-auto text-[10px] text-text-3">⚙ {d.effort}</span>}
      </div>
      {caps && (
        <div className="mt-1 flex flex-wrap gap-1 text-[9px] text-text-3">
          {providerId && <span className="rounded-none border border-line px-1">{PROVIDERS[providerId].name}</span>}
          <span className={cn("rounded-none border px-1", caps.browser ? "border-line" : "border-line/40 line-through opacity-60")}>{t("mind.cap.browser")}</span>
          <span className={cn("rounded-none border px-1", caps.image ? "border-line" : "border-line/40 line-through opacity-60")}>{t("mind.cap.image")}</span>
          <span className={cn("rounded-none border px-1", caps.resume ? "border-line" : "border-line/40 line-through opacity-60")}>{t("mind.cap.resume")}</span>
          {offCount > 0 && <span className="rounded-none border border-warn/60 px-1 text-warn">{t("mind.offCount", { n: offCount })}</span>}
        </div>
      )}
      {lastLine ? <div className="mono mt-1 line-clamp-2 text-[10px] leading-4 text-text-2" data-testid="mind-node-last">› {lastLine}</div> : <div className="mt-1 line-clamp-2 text-[10px] text-text-3">{t(`mind.roleHint.${d.role}` as never)}</div>}
    </Shell>
  )
}

export function GatewayNode({ data }: NodeProps<MindFlowNode>) {
  const t = useT()
  const n = data.node
  const prompt = n.data.type === "gateway" ? n.data.prompt : ""
  return (
    <Shell node={n} icon={<Settings2 />} title={t("mind.node.gateway")} warnings={data.warnings} accent="var(--mind)" testId="mind-node-gateway">
      <div className="line-clamp-4 text-[11px] leading-4 whitespace-pre-wrap text-text-2">{prompt.trim() || t("mind.gatewayEmpty")}</div>
    </Shell>
  )
}

export function MemoryNode({ data }: NodeProps<MindFlowNode>) {
  const t = useT()
  const n = data.node
  const entries = useMemoryStore((s) => s.entries)
  const depot = entries.filter((e) => e.layer === "mind" && e.scopeId === data.modelId && e.pinned)
  return (
    <Shell node={n} icon={<Database />} title={t("mind.node.memory")} warnings={data.warnings} target={false} testId="mind-node-memory">
      <div className="text-[11px]">{t("mind.depotCount", { n: depot.length })}</div>
      {depot.slice(0, 2).map((e) => <div key={e.id} className="mt-0.5 truncate text-[10px] text-text-3">• {e.body}</div>)}
    </Shell>
  )
}

export function ToolsNode({ data }: NodeProps<MindFlowNode>) {
  const t = useT()
  const n = data.node
  const d = n.data.type === "tools" ? n.data : { type: "tools" as const, tools: { browser: true, files: true, shell: true, network: true, image: false } }
  const on = (Object.keys(d.tools) as Array<keyof typeof d.tools>).filter((k) => d.tools[k])
  return (
    <Shell node={n} icon={<Wrench />} title={t("mind.node.tools")} warnings={data.warnings} target={false} testId="mind-node-tools">
      <div className="flex flex-wrap gap-1">
        {on.map((k) => <span key={k} className="rounded-none border border-line px-1 text-[10px] text-text-2">{t(`mind.tool.${k}` as never)}</span>)}
        {on.length === 0 && <span className="text-[10px] text-text-3">{t("common.none")}</span>}
      </div>
      <div className="mono mt-1 truncate text-[10px] text-text-3">{d.workspace ? d.workspace.replace(/^\/Users\/[^/]+/, "~") : t("mind.noFolder")}</div>
    </Shell>
  )
}

export function LiveNode({ data }: NodeProps<MindFlowNode>) {
  const t = useT()
  const n = data.node
  const entries = useMemoryStore((s) => s.entries)
  const stage = useMindStore((s) => s.activity[data.modelId]?.stage)
  const mine = entries.filter((e) => e.layer === "mind" && e.scopeId === data.modelId && !e.pinned).sort((a, b) => b.createdAt - a.createdAt)
  return (
    <Shell node={n} icon={<Sparkles />} title={t("mind.node.live")} warnings={data.warnings} ring={stage === "memory" ? "border-mind animate-pulse" : "border-mind/60"} target={false} source={false} testId="mind-node-live" badge={stage === "memory" ? <span className="ml-auto normal-case tracking-normal text-mind">{t("mind.stage.memory")}</span> : undefined}>
      <div className="flex items-center gap-1.5 text-[10px] text-mind"><span className="size-1.5 animate-pulse-soft rounded-full bg-mind" />{mine.length} {t("mind.liveCount")}</div>
      {mine.length === 0 && <div className="mt-1 text-[10px] text-text-3">{t("mind.liveEmpty")}</div>}
      {mine.slice(0, 4).map((e) => <div key={e.id} className="mt-0.5 truncate text-[10px] text-text-2">• {e.body}</div>)}
    </Shell>
  )
}

/** Düşünme: Bilinç's thinking live — the DÜŞÜNCE block and reasoning/tool status lines of the current turn. */
export function ThinkingNode({ data }: NodeProps<MindFlowNode>) {
  const t = useT()
  const n = data.node
  const stage = useMindStore((s) => s.activity[data.modelId]?.stage)
  const thoughts = useMindStore((s) => s.activity[data.modelId]?.thoughts)
  const thinking = stage === "bilinc" || stage === "tek"
  const list = thoughts ?? []
  const dusunce = [...list].reverse().find((x) => x.kind === "dusunce")
  const reasons = list.filter((x) => x.kind === "reason").slice(-4)
  return (
    <Shell node={n} icon={<BrainCog />} title={t("mind.node.thinking")} warnings={data.warnings} ring={thinking ? "border-mind animate-pulse" : "border-mind/60"} target={false} source={false} testId="mind-node-thinking" badge={thinking ? <span className="ml-auto normal-case tracking-normal text-mind">{t("mind.thinkingNow")}</span> : undefined}>
      {list.length === 0 && <div className="text-[10px] text-text-3">{t("mind.thinkingEmpty")}</div>}
      {dusunce && <div className="whitespace-pre-wrap text-[10px] leading-4 text-text-1" data-testid="mind-node-dusunce">{dusunce.text}</div>}
      {reasons.length > 0 && (
        <div className={cn("mono text-[9px] leading-4 text-text-3", dusunce && "mt-1 border-t border-line pt-1")}>
          {reasons.map((r) => <div key={r.at + r.text} className="truncate">⋯ {r.text}</div>)}
        </div>
      )}
    </Shell>
  )
}

export const MIND_NODE_TYPES = { model: ModelNode, gateway: GatewayNode, memory: MemoryNode, tools: ToolsNode, live: LiveNode, thinking: ThinkingNode }
