import { cn } from "cn"
import { FileCode2, TerminalSquare, RotateCcw } from "lucide-react"
import type { Subtask } from "@/domain"
import { GlowCard } from "./GlowCard"
import { ModelLogo } from "./ModelLogo"
import { StatusBadge, WORKER_STATE_META } from "./StatusBadge"
import { ProgressBar } from "./ProgressBar"
import { KIND_LABEL } from "./RouteGraph"
import { PROVIDERS } from "@/providers/registry"
import type { ProviderId } from "@/domain"
import { formatRelative } from "@/lib/format"

/** One card per subtask/worker in the Live Monitor. Click opens the terminal drawer. */
export function AgentWorkerCard({ subtask, onOpen, className, selected, now, kindLabel, stateLabel }: { subtask: Subtask; onOpen?: () => void; className?: string; selected?: boolean; now?: number; kindLabel?: string; stateLabel?: string }) {
  const meta = WORKER_STATE_META[subtask.state]
  const [providerId, ...rest] = (subtask.assignedModelId ?? "").split(":")
  const model = subtask.assignedModelId ? { displayName: rest.join(":") || PROVIDERS[providerId as ProviderId]?.name || subtask.assignedModelId, cli: PROVIDERS[providerId as ProviderId]?.name ?? providerId } : undefined
  const tone = subtask.state === "failed" ? "danger" : subtask.state === "completed" ? "success" : subtask.state === "blocked" ? "warn" : meta.active ? "cyan" : "default"
  const retries = subtask.attempts.length - 1
  return (
    <GlowCard interactive active={selected} tone={selected ? "cyan" : tone} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen?.()} className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {subtask.assignedModelId ? <ModelLogo modelRef={subtask.assignedModelId} size={18} /> : <span className="flex size-[27px] items-center justify-center rounded-lg border border-dashed border-line-strong text-text-3">·</span>}
          <div className="min-w-0 flex-1">
            <div className="truncate font-heading text-sm font-semibold text-text-1">{model?.displayName ?? "Unassigned"}</div>
            <div className="truncate text-[11px] text-text-3">{model?.cli ? `${model.cli} · ` : ""}{kindLabel ?? KIND_LABEL[subtask.kind]}</div>
          </div>
        </div>
        <StatusBadge state={subtask.state} size="xs" label={stateLabel} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs text-text-2">{subtask.title}</div>
        <ProgressBar value={subtask.progress} active={meta.active} tone={subtask.state === "failed" ? "danger" : subtask.state === "completed" ? "success" : "cyan"} className="mt-2" />
      </div>
      <div className="flex items-center gap-3 text-[11px] text-text-3">
        <span className="flex items-center gap-1"><FileCode2 className="size-3" />{subtask.files.length}</span>
        <span className="flex items-center gap-1"><TerminalSquare className="size-3" />{subtask.commands.length}</span>
        {retries > 0 && <span className="flex items-center gap-1 text-warn"><RotateCcw className="size-3" />{retries}</span>}
        <span className="ml-auto">{formatRelative(subtask.lastUpdate, now)}</span>
      </div>
    </GlowCard>
  )
}
