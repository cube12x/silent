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
        variant === "default" && "rounded-md bg-text-1 text-black font-semibold hover:bg-white",
        variant === "default" && glow && "",
        variant === "outline" && "rounded-md border-line-strong bg-transparent hover:border-text-2 hover:bg-ink-3",
        variant === "ghost" && "hover:bg-ink-3 hover:text-text-1",
        "transition-colors duration-150",
        className,
      )}
      {...props}
    />
  )
}
