import * as React from "react"
import { cn } from "cn"

type Tone = "neutral" | "cyan" | "blue" | "violet" | "success" | "warn" | "danger"

const TONE: Record<Tone, string> = {
  neutral: "border-line-strong bg-ink-3/60 text-text-2",
  cyan: "border-cyan/40 bg-cyan/10 text-cyan",
  blue: "border-blue/40 bg-blue/10 text-[color-mix(in_oklch,var(--blue)_70%,white)]",
  violet: "border-violet/40 bg-violet/10 text-[color-mix(in_oklch,var(--violet)_70%,white)]",
  success: "border-success/40 bg-success/10 text-success",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-danger/40 bg-danger/10 text-danger",
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
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border font-medium tracking-wide whitespace-nowrap uppercase",
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
