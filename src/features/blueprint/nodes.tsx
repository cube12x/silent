import * as React from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { cn } from "cn"
import { Bot, FileText, FolderGit2, Image, Play, Send, RotateCcw, Sparkles, Wand2, Variable, Package } from "lucide-react"
import type { BpAiData, BpNode, BpNodeStatus, BpVariableData, ProviderId } from "@/domain"
import { useRunsStore } from "@/stores/runs"
import { formatTokens } from "@/lib/format"
import { ModelLogo } from "@/design-system"
import { PROVIDERS } from "@/providers/registry"
import { useT } from "@/i18n"

export type BpFlowNode = { id: string; type: string; position: { x: number; y: number }; data: { node: BpNode; warnings: string[]; log?: string } }

const STATUS_RING: Record<BpNodeStatus, string> = {
  idle: "border-line",
  running: "border-text-1 animate-pulse",
  done: "border-success/70",
  failed: "border-danger/70",
  listening: "border-warn/70",
}

function providerColor(modelRef: string | undefined): string | undefined {
  const id = modelRef?.split(":")[0] as ProviderId | undefined
  return id ? PROVIDERS[id]?.color : undefined
}

function Shell({ node, icon, title, subtitle, children, warnings, accent, className }: { node: BpNode; icon: React.ReactNode; title: string; subtitle?: string; children?: React.ReactNode; warnings: string[]; accent?: string; className?: string }) {
  const t = useT()
  return (
    <div className={cn("relative w-[220px] rounded-sm border bg-ink-2 text-text-1 shadow-[0_8px_30px_rgba(0,0,0,0.35)]", STATUS_RING[node.status ?? "idle"], className)} style={accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : undefined}>
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.16em] uppercase text-text-2">
        <span className="[&_svg]:size-3.5">{icon}</span>
        <span className="truncate">{title}</span>
        {node.status === "running" && <span className="ml-auto mono normal-case tracking-normal text-text-3">…</span>}
        {warnings.length > 0 && <span title={warnings.map((w) => t(`bp.warn.${w}` as never)).join("\n")} className="ml-auto text-warn">▲</span>}
      </div>
      <div className="px-2.5 py-2 text-xs text-text-2">
        {subtitle && <div className="truncate text-[11px] text-text-3">{subtitle}</div>}
        {children}
      </div>
      <Handle type="target" position={Position.Left} className="!size-2.5 !rounded-full !border !border-line !bg-ink-0" />
      <Handle type="source" position={Position.Right} className="!size-2.5 !rounded-full !border !border-text-2 !bg-text-1" />
    </div>
  )
}

export function PromptNode({ data }: NodeProps<BpFlowNode>) {
  const t = useT()
  const n = data.node
  const d = n.data.type === "prompt" ? n.data : { title: "", text: "" }
  return (
    <Shell node={n} icon={<FileText />} title={d.title || t("bp.node.prompt")} warnings={data.warnings}>
      <div className="line-clamp-4 whitespace-pre-wrap text-[11px] leading-4 text-text-2">{d.text || t("bp.promptEmpty")}</div>
    </Shell>
  )
}

export function AiNode({ data }: NodeProps<BpFlowNode>) {
  const t = useT()
  const n = data.node
  const d: BpAiData = n.data.type === "ai" ? n.data : { modelRef: "", mode: "orchestration" }
  const runId = n.executionId && !n.executionId.startsWith("session:") ? n.executionId : undefined
  // Live tokens of an orchestration run in flight (primitive selector: a number, never a fresh object).
  const live = useRunsStore((s) => (runId && n.status === "running" ? (s.byId(runId)?.plan ?? []).reduce((acc, st) => acc + (st.tokens ?? 0), 0) : 0))
  const questions = useRunsStore((s) => (runId && n.status === "running" ? (s.byId(runId)?.plan ?? []).filter((st) => st.state === "blocked" && st.question).length : 0))
  const tokens = (d.tokens ?? 0) + live
  const extra = (d.pool ?? []).filter((p) => p !== d.modelRef)
  return (
    <Shell node={n} icon={<Bot />} title={n.data.type === "ai" && n.data.title ? n.data.title : t("bp.node.ai")} warnings={data.warnings} accent={providerColor(d.modelRef)}>
      <div className="flex items-center gap-2">
        {d.modelRef ? <ModelLogo modelRef={d.modelRef} size={14} /> : null}
        <span className="mono truncate text-[11px]">{d.modelRef ? d.modelRef.split(":")[1] : t("bp.noModel")}</span>
        {tokens > 0 && <span className="mono ml-auto shrink-0 text-[10px] text-text-3">{formatTokens(tokens)} tok</span>}
      </div>
      {questions > 0 && <div className="mt-1 text-[10px] font-semibold text-warn">❓ {t("bp.questions", { n: questions })}</div>}
      {extra.length > 0 && <div className="mono mt-0.5 truncate text-[10px] text-text-3">+ {extra.map((p) => p.split(":")[1]).join(", ")}</div>}
      <div className="mt-1 text-[10px] text-text-3">{t(`bp.mode.${d.mode}` as never)}{data.log ? ` · ${data.log}` : ""}</div>
    </Shell>
  )
}

export function BuildNode({ data }: NodeProps<BpFlowNode>) {
  const t = useT()
  const n = data.node
  const photo = n.type === "buildPhoto"
  const d = n.data.type === "build" || n.data.type === "buildPhoto" ? n.data : { title: "", folderPath: "", fileCount: 0, description: "" }
  return (
    <Shell node={n} icon={photo ? <Image /> : <FolderGit2 />} title={d.title || (photo ? t("bp.node.buildPhoto") : t("bp.node.build"))} warnings={data.warnings}>
      <div className="mono truncate text-[10px] text-text-3">{d.folderPath ? d.folderPath.replace(/^\/Users\/[^/]+/, "~") : t("bp.buildEmpty")}</div>
      <div className="mt-1 flex items-center justify-between text-[11px]"><span>{d.fileCount ?? 0} {t("bp.files")}</span>{d.description ? <span className="truncate pl-2 text-text-3" title={d.description}>{d.description}</span> : null}</div>
      <div className="mt-1 rounded-sm border border-dashed border-line px-1.5 py-1 text-center text-[10px] text-text-3">{t("bp.dropHint")}</div>
    </Shell>
  )
}

export function ButtonNode({ data }: NodeProps<BpFlowNode>) {
  const t = useT()
  const n = data.node
  const kind = n.data.type === "button" ? n.data.kind : "start"
  const icon = kind === "start" ? <Play /> : kind === "send" ? <Send /> : <RotateCcw />
  return (
    <Shell node={n} icon={icon} title={t(`bp.button.${kind}` as never)} warnings={data.warnings} className="w-[160px]">
      <div className="text-[10px] text-text-3">{t(`bp.buttonHint.${kind}` as never)}</div>
    </Shell>
  )
}

export function VariableNode({ data }: NodeProps<BpFlowNode>) {
  const t = useT()
  const n = data.node
  const d: BpVariableData = n.data.type === "variable" ? n.data : {}
  return (
    <Shell node={n} icon={<Variable />} title={t("bp.node.variable")} warnings={data.warnings} className="w-[190px] border-warn/40">
      <div className="mono text-[10px] text-text-3">{d.filter || "*"}</div>
      {d.lastEvent && <div className="mt-1 truncate text-[10px] text-warn">● {d.lastEvent.path.split("/").pop()}</div>}
    </Shell>
  )
}

export function WizardNode({ data }: NodeProps<BpFlowNode>) {
  const t = useT()
  const n = data.node
  const d = n.data.type === "wizard" ? n.data : { modelRef: "", purpose: "" }
  return (
    <Shell node={n} icon={<Wand2 />} title={n.data.type === "wizard" && n.data.title ? n.data.title : t("bp.node.wizard")} warnings={data.warnings} accent={providerColor(d.modelRef)}>
      <div className="flex items-center gap-2">{d.modelRef ? <ModelLogo modelRef={d.modelRef} size={14} /> : <Sparkles className="size-3.5 text-text-3" />}<span className="mono truncate text-[11px]">{d.modelRef ? d.modelRef.split(":")[1] : t("bp.noModel")}</span></div>
      <div className="mt-1 line-clamp-3 text-[10px] text-text-3">{d.purpose || t("bp.purposeEmpty")}</div>
    </Shell>
  )
}

export function StubNode({ data }: NodeProps<BpFlowNode>) {
  const t = useT()
  const n = data.node
  const d = n.data.type === "stub" ? n.data : { kinds: [], folder: "" }
  return (
    <Shell node={n} icon={<Package />} title={n.data.type === "stub" && n.data.title ? n.data.title : t("bp.node.stub")} warnings={data.warnings} className="w-[200px] border-dashed">
      <div className="mono truncate text-[10px] text-text-3">{d.folder || "assets/uydurma"}</div>
      <div className="mt-1 text-[10px] text-text-2">{d.kinds.length ? d.kinds.join(" · ") : t("bp.stubEmpty")}</div>
    </Shell>
  )
}

export const NODE_TYPES = { prompt: PromptNode, ai: AiNode, build: BuildNode, buildPhoto: BuildNode, button: ButtonNode, variable: VariableNode, wizard: WizardNode, stub: StubNode }
