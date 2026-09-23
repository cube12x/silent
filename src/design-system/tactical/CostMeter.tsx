import { cn } from "cn"
import { formatDuration, formatTokens, formatUsd } from "@/lib/format"

export function CostMeter({ tokens, costUsd, seconds, actual, className, compact }: { tokens: number; costUsd: number; seconds?: number; actual?: { tokens: number; costUsd: number }; className?: string; compact?: boolean }) {
  const cells = [
    { label: "tokens", value: formatTokens(tokens), actual: actual ? formatTokens(actual.tokens) : undefined },
    { label: "cost", value: formatUsd(costUsd), actual: actual ? formatUsd(actual.costUsd) : undefined },
    ...(seconds !== undefined ? [{ label: "time", value: `~${formatDuration(seconds * 1000)}`, actual: undefined as string | undefined }] : []),
  ]
  return (
    <div className={cn("grid gap-px overflow-hidden rounded-lg border border-line bg-line", `grid-cols-${cells.length}`, className)} style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
      {cells.map((c) => (
        <div key={c.label} className={cn("bg-ink-2/80 px-3", compact ? "py-1.5" : "py-2.5")}>
          <div className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{c.label}</div>
          <div className={cn("mono tabular-nums text-text-1", compact ? "text-sm" : "text-base")}>
            {c.actual ?? c.value}
            {c.actual && <span className="ml-1 text-[10px] text-text-3">est {c.value}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
