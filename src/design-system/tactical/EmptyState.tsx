import * as React from "react"
import { cn } from "cn"

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong/70 px-6 py-12 text-center", className)}>
      {icon && <div className="flex size-11 items-center justify-center rounded-xl border border-line bg-ink-2 text-cyan [&_svg]:size-5">{icon}</div>}
      <div className="font-heading text-sm font-semibold text-text-1">{title}</div>
      {description && <p className="max-w-md text-xs text-text-2">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
