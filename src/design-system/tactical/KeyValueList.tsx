import * as React from "react"
import { cn } from "cn"

export interface KV {
  label: string
  value: React.ReactNode
  mono?: boolean
}

export function KeyValueList({ items, className, columns = 1 }: { items: KV[]; className?: string; columns?: 1 | 2 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-2.5", columns === 2 ? "grid-cols-2" : "grid-cols-1", className)}>
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline justify-between gap-4 border-b border-line/70 pb-2 last:border-0">
          <dt className="shrink-0 text-[11px] font-medium tracking-wider text-text-3 uppercase">{it.label}</dt>
          <dd className={cn("min-w-0 truncate text-right text-sm text-text-1", it.mono && "mono text-xs")}>{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}
