import { cn } from "cn"
import { formatDuration, formatTokens, formatUsd } from "@/lib/format"

export function CostMeter({ tokens, seconds, actual, className, compact, labels }: { tokens: number; seconds?: number; actual?: { tokens: number; costUsd: number }; className?: string; compact?: boolean; labels?: { tokens: string; time: string; cost: string; estimate: string } }) {
  const L = labels ?? { tokens: "tokens", time: "time", cost: "cost", estimate: "est" }
  const cells: Array<{ label: string; value: string; actual?: string }> = [
    { label: L.tokens, value: formatTokens(tokens), actual: actual ? formatTokens(actual.tokens) : undefined },
    ...(seconds !== undefined ? [{ label: L.time, value: `~${formatDuration(seconds * 1000)}` }] : []),
    ...(actual && actual.costUsd > 0 ? [{ label: L.cost, value: formatUsd(actual.costUsd) }] : []),
  ]
  return (
    <div className={cn("grid gap-px overflow-hidden rounded-lg border border-line bg-line", className)} style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
      {cells.map((c) => (
        <div key={c.label} className={cn("bg-ink-2/80 px-3", compact ? "py-1.5" : "py-2.5")}>
          <div className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{c.label}</div>
          <div className={cn("mono tabular-nums text-text-1", compact ? "text-sm" : "text-base")}>
            {c.actual ?? c.value}
            {c.actual && <span className="ml-1 text-[10px] text-text-3">{L.estimate} {c.value}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
