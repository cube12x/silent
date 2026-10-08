import * as React from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { cn } from "cn"
import { Bot, Database, Eye, Hammer, Settings2, Sparkles, Wrench } from "lucide-react"
import type { MindNode, MindNodeData } from "@/domain"
import { ModelLogo } from "@/design-system"
import { useMemoryStore } from "@/stores/memory"
import { useMindStore } from "@/stores/mind"
import { modelRefColor, modelRefShort, roleColor } from "@/engine/mind/colors"
import { useT } from "@/i18n"

export type MindFlowNode = { id: string; type: string; position: { x: number; y: number }; data: { node: MindNode; warnings: string[]; modelId: string } }

function Shell({ node, icon, title, children, warnings, accent, ring, target = true, source = true, testId }: { node: MindNode; icon: React.ReactNode; title: string; children?: React.ReactNode; warnings: string[]; accent?: string; ring?: string; target?: boolean; source?: boolean; testId: string }) {
  const t = useT()
  return (
    <div data-testid={testId} className={cn("relative w-[220px] rounded-none border bg-ink-2 text-text-1 shadow-[0_8px_30px_rgba(0,0,0,0.35)]", ring ?? "border-line")} style={accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : undefined}>
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.16em] text-text-2 uppercase">
        <span className="[&_svg]:size-3.5">{icon}</span>
        <span className="truncate">{title}</span>
        {warnings.length > 0 && <span title={warnings.map((w) => t(`mind.warn.${w}` as never)).join("\n")} className="ml-auto text-warn">▲</span>}
      </div>
      <div className="px-2.5 py-2 text-xs text-text-2">{children}</div>
      {target && <Handle type="target" position={Position.Left} className="!size-2.5 !rounded-full !border !border-line !bg-ink-0" />}
      {source && <Handle type="source" position={Position.Right} className="!size-2.5 !rounded-full !border !border-text-2 !bg-text-1" />}
      {void node}
    </div>
  )
}

export function ModelNode({ data }: NodeProps<MindFlowNode>) {
  const t = useT()
  const n = data.node
  const d = n.data.type === "model" ? n.data : ({ type: "model", role: "tek", modelRef: "" } as Extract<MindNodeData, { type: "model" }>)
  const busy = useMindStore((s) => s.busy[data.modelId])
  const active = (busy === "bilinc" && d.role === "bilinc") || (busy === "eylem" && d.role === "eylem") || (busy === "tek" && d.role === "tek") || (busy === "terminal" && d.role === "eylem")
  const icon = d.role === "bilinc" ? <Eye /> : d.role === "eylem" ? <Hammer /> : <Bot />
  return (
    <Shell node={n} icon={icon} title={d.title || t(`mind.role.${d.role}` as never)} warnings={data.warnings} accent={roleColor(d.role)} ring={active ? "border-text-1 animate-pulse" : undefined} source={false} testId={`mind-node-model-${d.role}`}>
      <div className="flex items-center gap-2">
        {d.modelRef ? <ModelLogo modelRef={d.modelRef} size={14} /> : <Sparkles className="size-3.5 text-text-3" />}
        <span className="mono truncate text-[11px]" style={d.modelRef ? { color: modelRefColor(d.modelRef) } : undefined}>{d.modelRef ? modelRefShort(d.modelRef) : t("mind.noModelRef")}</span>
        {d.effort && <span className="ml-auto text-[10px] text-text-3">⚙ {d.effort}</span>}
      </div>
      <div className="mt-1 line-clamp-2 text-[10px] text-text-3">{t(`mind.roleHint.${d.role}` as never)}</div>
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
  const busy = useMindStore((s) => s.busy[data.modelId])
  const mine = entries.filter((e) => e.layer === "mind" && e.scopeId === data.modelId && !e.pinned).sort((a, b) => b.createdAt - a.createdAt)
  return (
    <Shell node={n} icon={<Sparkles />} title={t("mind.node.live")} warnings={data.warnings} ring={busy === "memory" ? "border-mind animate-pulse" : "border-mind/60"} target={false} source={false} testId="mind-node-live">
      <div className="flex items-center gap-1.5 text-[10px] text-mind"><span className="size-1.5 animate-pulse-soft rounded-full bg-mind" />{mine.length} {t("mind.liveCount")}</div>
      {mine.length === 0 && <div className="mt-1 text-[10px] text-text-3">{t("mind.liveEmpty")}</div>}
      {mine.slice(0, 4).map((e) => <div key={e.id} className="mt-0.5 truncate text-[10px] text-text-2">• {e.body}</div>)}
    </Shell>
  )
}

export const MIND_NODE_TYPES = { model: ModelNode, gateway: GatewayNode, memory: MemoryNode, tools: ToolsNode, live: LiveNode }
