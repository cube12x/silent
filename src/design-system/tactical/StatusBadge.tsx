import { cn } from "cn"
import type { RunStatus, WorkerState } from "@/domain"
import { TacticalChip } from "./TacticalChip"

type Tone = "neutral" | "cyan" | "blue" | "violet" | "success" | "warn" | "danger"

export const WORKER_STATE_META: Record<WorkerState, { label: string; tone: Tone; active: boolean }> = {
  planning: { label: "Planning", tone: "blue", active: true },
  thinking: { label: "Thinking", tone: "violet", active: true },
  coding: { label: "Coding", tone: "cyan", active: true },
  testing: { label: "Testing", tone: "cyan", active: true },
  reviewing: { label: "Reviewing", tone: "violet", active: true },
  waiting: { label: "Waiting", tone: "neutral", active: false },
  blocked: { label: "Blocked", tone: "warn", active: false },
  completed: { label: "Completed", tone: "success", active: false },
  failed: { label: "Failed", tone: "danger", active: false },
}

export const RUN_STATUS_META: Record<RunStatus, { label: string; tone: Tone; active: boolean }> = {
  draft: { label: "Draft", tone: "neutral", active: false },
  planned: { label: "Planned", tone: "blue", active: false },
  running: { label: "Running", tone: "cyan", active: true },
  completed: { label: "Completed", tone: "success", active: false },
  failed: { label: "Failed", tone: "danger", active: false },
  cancelled: { label: "Cancelled", tone: "warn", active: false },
}

export function StatusBadge({ state, className, size }: { state: WorkerState; className?: string; size?: "xs" | "sm" }) {
  const meta = WORKER_STATE_META[state]
  return (
    <TacticalChip tone={meta.tone} dot pulse={meta.active} size={size} className={cn(className)}>
      {meta.label}
    </TacticalChip>
  )
}

export function RunStatusBadge({ status, className, size }: { status: RunStatus; className?: string; size?: "xs" | "sm" }) {
  const meta = RUN_STATUS_META[status]
  return (
    <TacticalChip tone={meta.tone} dot pulse={meta.active} size={size} className={className}>
      {meta.label}
    </TacticalChip>
  )
}
