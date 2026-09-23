import * as React from "react"
import { cn } from "cn"

type Tone = "default" | "cyan" | "violet" | "success" | "warn" | "danger"

const TONE: Record<Tone, string> = {
  default: "",
  cyan: "border-text-2",
  violet: "border-text-2",
  success: "border-success/50",
  warn: "border-warn/50",
  danger: "border-danger/50",
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
        "panel relative rounded-md text-sm text-text-1 transition-[border-color] duration-150",
        padded && "p-4",
        interactive && "cursor-pointer hover:border-line-strong   outline-none",
        active && "border-text-1",
        TONE[tone],
        className,
      )}
      tabIndex={interactive ? 0 : undefined}
      {...props}
    />
  )
}
