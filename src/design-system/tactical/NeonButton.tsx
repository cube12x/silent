import * as React from "react"
import { cn } from "cn"
import { Button, type buttonVariants } from "@/components/ui/button"
import type { VariantProps } from "class-variance-authority"

export interface NeonButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  glow?: boolean
  asChild?: boolean
}

/** shadcn Button with the Silent primary treatment: cyan fill, dark text, glow on hover. */
export function NeonButton({ className, glow = true, variant = "default", ...props }: NeonButtonProps) {
  return (
    <Button
      variant={variant}
      className={cn(
        variant === "default" && "bg-cyan text-[#04131a] font-semibold hover:bg-cyan hover:brightness-110",
        variant === "default" && glow && "shadow-[0_0_0_1px_color-mix(in_oklch,var(--cyan)_40%,transparent),0_0_18px_color-mix(in_oklch,var(--cyan)_28%,transparent)] hover:shadow-glow-strong",
        variant === "outline" && "border-line-strong bg-ink-2/60 hover:border-cyan/50 hover:bg-ink-3 hover:text-cyan",
        variant === "ghost" && "hover:bg-ink-3 hover:text-text-1",
        "transition-all duration-200",
        className,
      )}
      {...props}
    />
  )
}
