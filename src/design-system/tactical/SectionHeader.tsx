import * as React from "react"
import { cn } from "cn"

export function SectionHeader({ title, eyebrow, description, actions, className, size = "md" }: { title: React.ReactNode; eyebrow?: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={cn("flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[10px] font-semibold tracking-[0.18em] text-cyan/80 uppercase">{eyebrow}</div>}
        <h2 className={cn("truncate font-heading font-semibold tracking-tight text-text-1", size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base")}>{title}</h2>
        {description && <p className="mt-1 text-xs text-text-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function PageHeader({ title, eyebrow, description, actions, className }: { title: React.ReactNode; eyebrow?: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[10px] font-semibold tracking-[0.2em] text-cyan/80 uppercase">{eyebrow}</div>}
        <h1 className="font-heading text-[clamp(1.5rem,1.2rem+0.8vw,2.25rem)] leading-none font-semibold tracking-tight text-text-1">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm text-text-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
