import * as React from "react"
import { cn } from "cn"

type Tone = "default" | "cyan" | "violet" | "success" | "warn" | "danger"

const TONE: Record<Tone, string> = {
  default: "",
  cyan: "border-cyan/35 shadow-glow",
  violet: "border-violet/40 shadow-[0_0_0_1px_color-mix(in_oklch,var(--violet)_30%,transparent),0_0_24px_color-mix(in_oklch,var(--violet)_18%,transparent)]",
  success: "border-success/35 shadow-[0_0_0_1px_color-mix(in_oklch,var(--success)_25%,transparent),0_0_24px_color-mix(in_oklch,var(--success)_14%,transparent)]",
  warn: "border-warn/35",
  danger: "border-danger/40 shadow-[0_0_0_1px_color-mix(in_oklch,var(--danger)_25%,transparent),0_0_24px_color-mix(in_oklch,var(--danger)_14%,transparent)]",
}

export interface GlowCardProps extends React.ComponentProps<"div"> {
  tone?: Tone
  interactive?: boolean
  active?: boolean
  padded?: boolean
}

/** Panel surface with an optional accent glow. The base building block of every screen. */
export function GlowCard({ className, tone = "default", interactive, active, padded = true, ...props }: GlowCardProps) {
  return (
    <div
      data-slot="glow-card"
      className={cn(
        "panel relative rounded-xl text-sm text-text-1 transition-[box-shadow,border-color,transform] duration-200",
        padded && "p-4",
        interactive && "cursor-pointer hover:border-line-strong hover:shadow-glow focus-visible:shadow-glow outline-none",
        active && "border-cyan/50 shadow-glow",
        TONE[tone],
        className,
      )}
      tabIndex={interactive ? 0 : undefined}
      {...props}
    />
  )
}
