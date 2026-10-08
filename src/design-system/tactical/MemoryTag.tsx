import { cn } from "cn"
import type { MemoryLayer } from "@/domain"

export const LAYER_TONE: Record<MemoryLayer, string> = {
  user: "border-violet/40 bg-violet/10 text-[color-mix(in_oklch,var(--violet)_70%,white)]",
  repo: "border-cyan/40 bg-cyan/10 text-cyan",
  session: "border-blue/40 bg-blue/10 text-[color-mix(in_oklch,var(--blue)_70%,white)]",
  daily: "border-success/40 bg-success/10 text-success",
  mind: "border-mind/40 bg-mind/10 text-mind",
}

export function MemoryTag({ tag, layer, className }: { tag: string; layer?: MemoryLayer; className?: string }) {
  return (
    <span className={cn("mono inline-flex h-5 items-center rounded border px-1.5 text-[10px]", layer ? LAYER_TONE[layer] : "border-line-strong bg-ink-3 text-text-2", className)}>
      #{tag}
    </span>
  )
}
