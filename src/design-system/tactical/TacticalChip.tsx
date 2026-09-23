import * as React from "react"
import { cn } from "cn"

type Tone = "neutral" | "cyan" | "blue" | "violet" | "success" | "warn" | "danger"

const TONE: Record<Tone, string> = {
  neutral: "border-line-strong bg-ink-3 text-text-2",
  cyan: "border-text-2 bg-ink-3 text-text-1",
  blue: "border-blue/50 bg-ink-3 text-blue",
  violet: "border-line-strong bg-ink-3 text-text-1",
  success: "border-success/50 bg-ink-3 text-success",
  warn: "border-warn/50 bg-ink-3 text-warn",
  danger: "border-danger/50 bg-ink-3 text-danger",
}

export interface TacticalChipProps extends React.ComponentProps<"span"> {
  tone?: Tone
  mono?: boolean
  dot?: boolean
  pulse?: boolean
  size?: "xs" | "sm"
}

/** Compact, sharp-edged label. Used for models, states, kinds, paths. */
export function TacticalChip({ className, tone = "neutral", mono, dot, pulse, size = "sm", children, ...props }: TacticalChipProps) {
  return (
    <span
      data-slot="chip"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-sm border font-medium tracking-wide whitespace-nowrap uppercase",
        size === "xs" ? "h-5 px-1.5 text-[10px]" : "h-6 px-2 text-[11px]",
        mono && "mono normal-case tracking-normal",
        TONE[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn("size-1.5 rounded-full bg-current", pulse && "animate-pulse-soft")} />}
      {children}
    </span>
  )
}
