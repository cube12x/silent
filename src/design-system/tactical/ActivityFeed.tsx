import { cn } from "cn"
import { Bot, Brain, MessageSquare, Play, Smartphone, Cpu, CheckCircle2, XCircle } from "lucide-react"
import type { ActivityItem } from "@/mocks/activity"
import { formatRelative } from "@/lib/format"

const ICON: Record<ActivityItem["kind"], React.ComponentType<{ className?: string }>> = { run: Play, chat: MessageSquare, agent: Bot, memory: Brain, system: Cpu, phone: Smartphone }

export function ActivityFeed({ items, className, onOpen, compact, limit }: { items: ActivityItem[]; className?: string; onOpen?: (item: ActivityItem) => void; compact?: boolean; limit?: number }) {
  const list = limit ? items.slice(0, limit) : items
  if (!list.length) return <div className="px-2 py-6 text-center text-xs text-text-3">No activity yet.</div>
  return (
    <ul className={cn("flex flex-col", className)}>
      {list.map((it) => {
        const Icon = ICON[it.kind]
        return (
          <li key={it.id}>
            <button type="button" onClick={() => onOpen?.(it)} className={cn("group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-ink-3/60", compact && "py-1.5")}>
              <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-line bg-ink-2 text-text-2 group-hover:border-cyan/40 group-hover:text-cyan")}>
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn("truncate font-medium text-text-1", compact ? "text-xs" : "text-sm")}>{it.title}</span>
                  {it.ok ? <CheckCircle2 className="size-3 shrink-0 text-success/80" /> : <XCircle className="size-3 shrink-0 text-danger/80" />}
                </span>
                {it.detail && <span className="block truncate text-[11px] text-text-3">{it.detail}</span>}
              </span>
              <span className="mono shrink-0 pt-0.5 text-[10px] text-text-3">{formatRelative(it.at)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
