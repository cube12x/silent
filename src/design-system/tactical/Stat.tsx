import * as React from "react"
import { cn } from "cn"
import { GlowCard } from "./GlowCard"

export function Stat({ label, value, hint, icon, tone = "default", className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: "default" | "cyan" | "violet" | "success" | "warn" | "danger"; className?: string }) {
  return (
    <GlowCard tone={tone} className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">
        <span>{label}</span>
        {icon && <span className="text-text-2 [&_svg]:size-3.5">{icon}</span>}
      </div>
      <div className="font-heading text-[clamp(1.4rem,1.1rem+0.6vw,2rem)] leading-none font-semibold tracking-tight tabular-nums text-text-1">{value}</div>
      {hint && <div className="text-xs text-text-2">{hint}</div>}
    </GlowCard>
  )
}
