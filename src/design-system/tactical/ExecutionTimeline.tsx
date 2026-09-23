import { cn } from "cn"
import type { Subtask } from "@/domain"
import { WORKER_STATE_META } from "./StatusBadge"
import { KIND_LABEL } from "./RouteGraph"
import { ModelTag } from "./ModelLogo"

/** Horizontal lane view of subtasks over time: waiting → active → terminal. */
export function ExecutionTimeline({ plan, className, onSelect, selectedId, kindLabels, stateLabels }: { plan: Subtask[]; className?: string; onSelect?: (id: string) => void; selectedId?: string; kindLabels?: Record<Subtask["kind"], string>; stateLabels?: Record<Subtask["state"], string> }) {
  return (
    <ol className={cn("relative flex flex-col gap-1.5", className)}>
      {plan.map((s, i) => {
        const meta = WORKER_STATE_META[s.state]
        const dep = s.dependsOn.length
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect?.(s.id)}
              className={cn("grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors", selectedId === s.id ? "border-cyan/50 bg-cyan/[0.05]" : "border-transparent hover:border-line hover:bg-ink-2/60")}
            >
              <span className="relative flex items-center justify-center">
                {i < plan.length - 1 && <span className="absolute top-6 h-[calc(100%+6px)] w-px bg-line" />}
                <span
                  className={cn("mono flex size-6 items-center justify-center rounded-md border text-[10px]", meta.active ? "border-cyan/60 text-cyan" : s.state === "completed" ? "border-success/50 text-success" : s.state === "failed" ? "border-danger/50 text-danger" : "border-line-strong text-text-3", meta.active && "animate-pulse-soft")}
                >
                  {i + 1}
                </span>
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="shrink-0 text-sm font-medium text-text-1">{(kindLabels ?? KIND_LABEL)[s.kind]}</span>
                  <span className="min-w-0 truncate text-xs text-text-3">{s.title.replace(/^[^:]+:\s*/, "")}</span>
                </span>
                <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-ink-4/80">
                  <span className={cn("block h-full rounded-full transition-[width] duration-500", s.state === "failed" ? "bg-danger" : s.state === "completed" ? "bg-success" : "bg-cyan")} style={{ width: `${s.progress}%` }} />
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                {s.assignedModelId ? <ModelTag modelRef={s.assignedModelId} size="xs" /> : <span className="text-[11px] text-text-3">{dep ? `waits on ${dep}` : "queued"}</span>}
                <span className={cn("text-[10px] tracking-wider uppercase", meta.active ? "text-cyan" : s.state === "completed" ? "text-success" : s.state === "failed" ? "text-danger" : "text-text-3")}>{stateLabels?.[s.state] ?? meta.label}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
