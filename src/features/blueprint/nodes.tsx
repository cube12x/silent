import * as React from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { cn } from "cn"
import { roleHint, roleLabel } from "./roles"
import { Bot, Eye, FileText, FolderGit2, Hammer, Image, Play, Send, RotateCcw, Sparkles, Wand2, Variable, Package, Split, ShieldCheck, Compass, ListOrdered, Camera, Globe, Wallet, Link2, Palette } from "lucide-react"
import type { BpAiData, BpNode, BpNodeStatus, BpVariableData, ProviderId } from "@/domain"
import { useRunsStore } from "@/stores/runs"
import { formatCountdown, formatTokens } from "@/lib/format"
import { useNow } from "@/lib/useNow"
import { useBlueprintsStore } from "@/stores/blueprints"
import { ModelLogo } from "@/design-system"
import { PROVIDERS } from "@/providers/registry"
import { useT } from "@/i18n"
import { rosterGlyph, teamRoster } from "@/engine/blueprint/roster"

export type BpFlowNode = { id: string; type: string; position: { x: number; y: number }; data: { node: BpNode; warnings: string[]; log?: string } }

const STATUS_RING: Record<BpNodeStatus, string> = {
  idle: "border-line",
  running: "border-text-1 animate-pulse",
  done: "border-success/70",
  failed: "border-danger/70",
  waiting: "border-warn/70",
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
  // The run object itself is a stable store reference (replaced only when it changes), so selecting it is loop-safe.
  const run = useRunsStore((s) => (runId ? s.byId(runId) : undefined))
  const plan = run?.plan
  // Only a run that is actually running adds live tokens (the box keeps its previous run's id while a re-run plans).
  const live = n.status === "running" && run?.status === "running" && plan ? plan.reduce((acc, st) => acc + (st.tokens ?? 0), 0) : 0
  const questions = n.status === "running" && plan ? plan.filter((st) => st.state === "blocked" && st.question).length : 0
  const tokens = (d.tokens ?? 0) + live
  const extra = (d.pool ?? []).filter((p) => p !== d.modelRef)
  const poolRefs = React.useMemo(() => Array.from(new Set([d.modelRef, ...(d.pool ?? [])].filter(Boolean))), [d.modelRef, d.pool])
  // Who is doing what: one row per model, its tasks underneath (orchestration runs only).
  const roster = React.useMemo(() => (plan && (d.mode === "orchestration" || d.mode === "lite") ? teamRoster(plan, poolRefs) : []), [plan, poolRefs, d.mode])
  // Quota waits tick every second on the box itself (2026-10-05): the timer runs only while something waits.
  const quotaWaiting = n.status === "running" && plan ? plan.filter((st) => st.state === "waiting" && st.waitingUntil) : []
  const now = useNow(1000, quotaWaiting.length > 0)
  const nextReset = quotaWaiting.length ? Math.min(...quotaWaiting.map((st) => st.waitingUntil!)) : 0
  const bpId = useBlueprintsStore((s) => s.activeId)
  const openHandover = (subtaskId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (bpId) useBlueprintsStore.getState().setFocusTask({ bpId, nodeId: n.id, subtaskId })
  }
  return (
    <Shell node={n} icon={d.role === "bilinc" ? <Eye /> : d.role === "eylem" ? <Hammer /> : d.role === "donusturucu" ? <Wand2 /> : d.role === "kesifci" ? <Compass /> : d.role === "dikis" ? <Link2 /> : d.mode === "lite" ? <Split /> : <Bot />} title={n.data.type === "ai" && n.data.title ? n.data.title : (roleLabel(d.role, t as never) ?? (d.mode === "lite" ? t("bp.node.bolucu") : t("bp.node.ai")))} warnings={data.warnings} accent={providerColor(d.modelRef)} className={cn(roster.length && "w-[280px]", (d.role === "bilinc" || d.role === "kesifci") && "border-dotted")}>
      <div className="flex items-center gap-2">
        {d.modelRef ? <ModelLogo modelRef={d.modelRef} size={14} /> : null}
        <span className="mono truncate text-[11px]">{d.modelRef ? d.modelRef.split(":")[1] : t("bp.noModel")}</span>
        {tokens > 0 && <span className="mono ml-auto shrink-0 text-[10px] text-text-3">{formatTokens(tokens)} tok</span>}
      </div>
      {questions > 0 && <div className="mt-1 text-[10px] font-semibold text-warn">❓ {t("bp.questions", { n: questions })}</div>}
      {quotaWaiting.length > 0 && <div className="mono mt-1 text-[10px] font-semibold text-warn" title={t("bp.quotaWaitTip")}>⏳ {t("bp.quotaWaits", { n: quotaWaiting.length, t: formatCountdown(nextReset - now) })}</div>}
      {extra.length > 0 && !roster.length && <div className="mono mt-0.5 truncate text-[10px] text-text-3">+ {extra.map((p) => p.split(":")[1]).join(", ")}</div>}
      <div className="mt-1 text-[10px] text-text-3">{t(`bp.mode.${d.mode}` as never)}{data.log ? ` · ${data.log}` : ""}</div>
      {d.role && <div className="mt-0.5 text-[10px] text-text-3">{roleHint(d.role, t as never)}{d.role !== "eylem" && d.report ? ` · 📄 ${t("bp.report")}` : ""}</div>}
      {(d.instructions?.trim() || d.repos?.length || d.effort) ? (
        <div className="mt-0.5 flex gap-2 text-[10px] text-text-3">
          {d.effort ? <span>⚙ {d.effort}</span> : null}
          {d.instructions?.trim() ? <span>✎ {t("bp.instructionsShort")}</span> : null}
          {d.repos?.length ? <span>⎇ {d.repos.length} repo</span> : null}
        </div>
      ) : null}
      {roster.length > 0 && n.status !== "running" && roster.some((r) => !r.tasks.length) && (
        <div className="mt-1 text-[10px] text-text-3">{t("bp.rosterUnused", { n: roster.filter((r) => !r.tasks.length).length })}</div>
      )}
      {roster.length > 0 && (
        <div className="mt-1.5 space-y-1 border-t border-line pt-1.5">
          {roster.filter((row) => row.tasks.length || n.status === "running").map((row) => {
            const done = row.tasks.filter((x) => x.state === "completed").length
            return (
              <div key={row.modelRef}>
                <div className="flex items-center gap-1.5">
                  <ModelLogo modelRef={row.modelRef} size={11} />
                  <span className="mono truncate text-[10px] text-text-2">{row.modelRef.split(":")[1]}</span>
                  <span className="mono ml-auto shrink-0 text-[9px] text-text-3">{row.tasks.length ? `${done}/${row.tasks.length}` : t("bp.rosterIdle")}</span>
                </div>
                {row.tasks.map((task) => {
                  const waiting = n.status === "running" && task.state === "waiting" && task.waitingUntil ? task.waitingUntil : 0
                  const g = rosterGlyph(task.state, waiting || undefined)
                  return (
                    <div key={task.id} className="flex items-center gap-1 pl-4 text-[10px] leading-4" title={waiting ? `${task.title} — ${t("bp.quotaWaitTip")}` : `${task.title} — ${task.state}`}>
                      <span className={cn("shrink-0", g.className)}>{g.glyph}</span>
                      <span className="min-w-0 truncate text-text-2">{task.title}</span>
                      {waiting ? <span className="mono ml-auto shrink-0 text-warn tabular-nums">{formatCountdown(waiting - now)}</span> : null}
                      {waiting || (n.status === "running" && task.state !== "completed" && task.state !== "failed") ? (
                        <button type="button" onClick={openHandover(task.id)} onDoubleClick={(e) => e.stopPropagation()} title={t("bp.devretHint")} className={cn("nodrag nopan shrink-0 rounded-sm border px-1 leading-4", waiting ? "ml-1 border-warn/50 text-warn hover:bg-warn/10" : "ml-auto border-line text-text-3 hover:text-text-1")}>↪ {t("bp.devret")}</button>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
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
  const icon = kind === "start" ? <Play /> : kind === "send" ? <Send /> : kind === "parallel" ? <Split /> : <RotateCcw />
  return (
    <Shell node={n} icon={icon} title={t(`bp.button.${kind}` as never)} warnings={data.warnings} className={cn("w-[160px]", kind === "parallel" && "border-accent/50")}>
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

export function CheckNode({ data }: NodeProps<BpFlowNode>) {
  const t = useT()
  const n = data.node
  const d = n.data.type === "check" ? n.data : { commands: [], lastOk: undefined, report: undefined, title: "" }
  const cmds = d.commands.length ? d.commands : ["npm run typecheck", "npm test", "npm run build"]
  return (
    <Shell node={n} icon={<ShieldCheck />} title={(n.data.type === "check" && n.data.title) || t("bp.node.check")} warnings={data.warnings} className="w-[200px] border-dashed">
      <div className="mono truncate text-[10px] text-text-3">{cmds.join(" · ")}</div>
      <div className={cn("mt-1 text-[10px]", d.lastOk === true ? "text-success" : d.lastOk === false ? "text-danger" : "text-text-3")}>{d.lastOk === true ? `✓ ${t("bp.checkGreen")}` : d.lastOk === false ? `✗ ${t("bp.checkRed")}` : t("bp.checkIdle")}{data.log ? ` · ${data.log}` : ""}</div>
    </Shell>
  )
}

export function QueueNode({ data }: NodeProps<BpFlowNode>) {
  const t = useT()
  const n = data.node
  const d = n.data.type === "queue" ? n.data : { modelRef: "", title: "", report: undefined }
  return (
    <Shell node={n} icon={<ListOrdered />} title={(n.data.type === "queue" && n.data.title) || t("bp.node.queue")} warnings={data.warnings} accent={providerColor(d.modelRef)} className="w-[200px]">
      <div className="mono truncate text-[10px] text-text-3">{d.modelRef || t("bp.warn.queue.noModel")}</div>
      <div className="mt-1 text-[10px] text-text-3">{t("bp.queueHint")}{data.log ? ` · ${data.log}` : ""}</div>
    </Shell>
  )
}

export function SnapshotNode({ data }: NodeProps<BpFlowNode>) {
  const t = useT()
  const n = data.node
  const d = n.data.type === "snapshot" ? n.data : { ref: undefined, takenAt: undefined, title: "" }
  return (
    <Shell node={n} icon={<Camera />} title={(n.data.type === "snapshot" && n.data.title) || t("bp.node.snapshot")} warnings={data.warnings} className="w-[190px] border-dashed">
      <div className="mono truncate text-[10px] text-text-3">{d.ref ? `${d.ref.split("/").pop()} · ${d.takenAt ? new Date(d.takenAt).toLocaleTimeString() : ""}` : t("bp.snapshotNone")}</div>
    </Shell>
  )
}

export function VerifyNode({ data }: NodeProps<BpFlowNode>) {
  const t = useT()
  const n = data.node
  const d = n.data.type === "verify" ? n.data : { modelRef: "", lanes: [] as string[], lastOk: undefined, title: "" }
  const lanes = d.lanes.filter((l) => l.trim())
  return (
    <Shell node={n} icon={<Globe />} title={(n.data.type === "verify" && n.data.title) || t("bp.node.verify")} warnings={data.warnings} accent={providerColor(d.modelRef)} className="w-[210px]">
      <div className="mono truncate text-[10px] text-text-3">{lanes.length} {t("bp.verifyLanesShort")} · {d.modelRef.split(":").pop()}</div>
      <div className={cn("mt-1 text-[10px]", d.lastOk === true ? "text-success" : d.lastOk === false ? "text-danger" : "text-text-3")}>{d.lastOk === true ? `✓ ${t("bp.checkGreen")}` : d.lastOk === false ? `✗ ${t("bp.verifyFindings")}` : t("bp.checkIdle")}{data.log ? ` · ${data.log}` : ""}</div>
    </Shell>
  )
}

export function BudgetNode({ data }: NodeProps<BpFlowNode>) {
  const t = useT()
  const n = data.node
  const d = n.data.type === "budget" ? n.data : { maxTokens: 0, spent: undefined, title: "" }
  return (
    <Shell node={n} icon={<Wallet />} title={(n.data.type === "budget" && n.data.title) || t("bp.node.budget")} warnings={data.warnings} className="w-[180px] border-dashed">
      <div className="mono text-[10px] text-text-3">≤ {formatTokens(d.maxTokens)}{d.spent !== undefined ? ` · ${formatTokens(d.spent)} ${t("bp.budgetSpent")}` : ""}</div>
    </Shell>
  )
}

export function ModelNode({ data }: NodeProps<BpFlowNode>) {
  const t = useT()
  const n = data.node
  const d = n.data.type === "model" ? n.data : { modelRef: "", requests: [], title: "", lastOk: undefined }
  const accepted = d.requests.filter((r) => r.status === "accepted").length
  const rejected = d.requests.filter((r) => r.status === "rejected").length
  return (
    <Shell node={n} icon={<Palette />} title={(n.data.type === "model" && n.data.title) || t("bp.node.model")} warnings={data.warnings} accent={providerColor(d.modelRef)} className="w-[220px]">
      <div className="mono truncate text-[10px] text-text-3">{d.requests.length ? `${accepted}/${d.requests.length} ${t("bp.modelStatus.accepted")}` : t("bp.modelRequestsEmpty").split(" — ")[0]} · {d.modelRef.split(":").pop()}</div>
      <div className={cn("mt-1 text-[10px]", n.status === "waiting" ? "text-warn" : d.lastOk === true ? "text-success" : rejected ? "text-danger" : "text-text-3")}>
        {n.status === "waiting" ? `⏸ ${t("bp.modelStatus.pending")} · ${d.requests.length - accepted}` : d.lastOk === true ? `✓ ${t("bp.checkGreen")}` : t("bp.checkIdle")}
        {rejected ? ` · ✗ ${rejected} ${t("bp.modelStatus.rejected")}` : ""}
      </div>
      <div className="mt-1 rounded-sm border border-dashed border-line px-1 py-0.5 text-[9px] text-text-3">{t("bp.modelDropHint")}</div>
    </Shell>
  )
}

export const NODE_TYPES = { prompt: PromptNode, ai: AiNode, build: BuildNode, buildPhoto: BuildNode, button: ButtonNode, variable: VariableNode, wizard: WizardNode, stub: StubNode, check: CheckNode, queue: QueueNode, snapshot: SnapshotNode, verify: VerifyNode, budget: BudgetNode, model: ModelNode }
