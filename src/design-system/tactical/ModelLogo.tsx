import { cn } from "cn"
import type { ProviderId } from "@/domain"
import { PROVIDERS } from "@/providers/registry"

/** Original vector monograms per CLI. Inline SVG, razor-sharp at any DPI. Not vendor trademarks. */
function Mark({ provider }: { provider: ProviderId }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 2.1, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  switch (provider) {
    case "codex":
      return <g {...s}><path d="M7 8l5 4-5 4" /><path d="M13 16h5" /></g>
    case "claude":
      return (
        <g {...s} strokeWidth={2}>
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i * Math.PI) / 4
            const r1 = i % 2 ? 4.2 : 3
            return <line key={i} x1={12 + Math.cos(a) * r1} y1={12 + Math.sin(a) * r1} x2={12 + Math.cos(a) * 8.5} y2={12 + Math.sin(a) * 8.5} />
          })}
        </g>
      )
    case "kimi":
      return <g {...s}><path d="M7 5v14" /><path d="M17 5l-8 7 8 7" /></g>
    case "grok":
      return <g {...s}><path d="M6 6l12 12" /><path d="M18 6l-5.2 5.2" /><path d="M6 18l4.2-4.2" /></g>
    case "gemini":
      return <path fill="currentColor" d="M12 3c.6 5 3.9 8.4 9 9-5.1.6-8.4 4-9 9-.6-5-3.9-8.4-9-9 5.1-.6 8.4-4 9-9z" />
    case "qwen":
      return <g {...s}><path d="M12 4l7 4v8l-7 4-7-4V8z" /><path d="M12 12l7-4M12 12v8M12 12L5 8" strokeWidth={1.4} /></g>
    case "opencode":
      return <g {...s}><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M8 10l3 2-3 2M13 14h3" /></g>
    case "copilot":
      return <g {...s}><path d="M5 12a7 7 0 0 1 14 0v3a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" /><circle cx="9.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="14.5" cy="12" r="1.2" fill="currentColor" stroke="none" /></g>
    case "cursor":
      return <g {...s}><path d="M6 4l12 8-5 1.5L11 19z" /></g>
    case "amp":
      return <g {...s}><path d="M4 16l4-8 4 8 4-8 4 8" /></g>
  }
}

export function ProviderLogo({ provider, size = 20, className, plain }: { provider: ProviderId; size?: number; className?: string; plain?: boolean }) {
  const color = PROVIDERS[provider].color
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-lg", !plain && "border border-line bg-ink-2", className)}
      style={{ width: size * 1.5, height: size * 1.5, color, boxShadow: plain ? undefined : `inset 0 0 0 1px color-mix(in oklch, ${color} 25%, transparent), 0 0 14px color-mix(in oklch, ${color} 18%, transparent)` }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ filter: `drop-shadow(0 0 4px color-mix(in oklch, ${color} 55%, transparent))` }}>
        <Mark provider={provider} />
      </svg>
    </span>
  )
}

/** Logo for a ModelRef (`provider:model`) or bare provider id. */
export function ModelLogo({ modelRef, size = 18, className, plain }: { modelRef: string; size?: number; className?: string; plain?: boolean }) {
  const provider = modelRef.split(":")[0] as ProviderId
  if (!PROVIDERS[provider]) return <span className={cn("inline-flex size-7 items-center justify-center rounded-lg border border-line bg-ink-2 text-[10px] text-text-3", className)}>?</span>
  return <ProviderLogo provider={provider} size={size} className={className} plain={plain} />
}

/** Inline "logo + name" tag. `label` overrides the derived name. */
export function ModelTag({ modelRef, label, className, size = "sm" }: { modelRef: string; label?: string; className?: string; size?: "xs" | "sm" }) {
  const [provider, ...rest] = modelRef.split(":")
  const info = PROVIDERS[provider as ProviderId]
  const name = label ?? (rest.join(":") || info?.name || modelRef)
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-text-1", size === "xs" ? "text-[11px]" : "text-xs", className)}>
      <ModelLogo modelRef={modelRef} size={size === "xs" ? 11 : 13} plain className="!size-4" />
      <span className="truncate font-medium">{name}</span>
    </span>
  )
}
