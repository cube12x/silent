import { cn } from "cn"
import type { ProviderId } from "@/domain"
import { MODEL_BY_ID } from "@/engine/capabilities"

/**
 * Original vector monograms per provider. Rendered as inline SVG so they stay razor-sharp at any DPI.
 * Deliberately not vendor trademarks: these are Silent's own placeholder marks.
 */
export const PROVIDER_COLOR: Record<ProviderId, string> = {
  codex: "var(--cyan)",
  claude: "#e8b98a",
  gemini: "#7c9cff",
  grok: "#e6eaf0",
  glm: "#4ade80",
  fable: "var(--violet)",
}

function Mark({ provider }: { provider: ProviderId }) {
  switch (provider) {
    case "codex":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 8l5 4-5 4" />
          <path d="M13 16h5" />
        </g>
      )
    case "claude":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i * Math.PI) / 4
            const r1 = i % 2 ? 4.2 : 3
            return <line key={i} x1={12 + Math.cos(a) * r1} y1={12 + Math.sin(a) * r1} x2={12 + Math.cos(a) * 8.5} y2={12 + Math.sin(a) * 8.5} />
          })}
        </g>
      )
    case "gemini":
      return <path fill="currentColor" d="M12 3c.6 5 3.9 8.4 9 9-5.1.6-8.4 4-9 9-.6-5-3.9-8.4-9-9 5.1-.6 8.4-4 9-9z" />
    case "grok":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M6 6l12 12" />
          <path d="M18 6l-5.2 5.2" />
          <path d="M6 18l4.2-4.2" />
        </g>
      )
    case "glm":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" />
          <path d="M12 8.5v7M8.8 10.3l6.4 3.4M15.2 10.3l-6.4 3.4" strokeWidth="1.5" />
        </g>
      )
    case "fable":
      return (
        <g fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
          <path d="M12 12c-1.8-3-3.6-4.5-5.5-4.5C4 7.5 3 9.5 3 12s1 4.5 3.5 4.5c1.9 0 3.7-1.5 5.5-4.5 1.8 3 3.6 4.5 5.5 4.5 2.5 0 3.5-2 3.5-4.5s-1-4.5-3.5-4.5c-1.9 0-3.7 1.5-5.5 4.5z" />
        </g>
      )
  }
}

export function ProviderLogo({ provider, size = 20, className, plain }: { provider: ProviderId; size?: number; className?: string; plain?: boolean }) {
  const color = PROVIDER_COLOR[provider]
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

export function ModelLogo({ modelId, size = 18, className, plain }: { modelId: string; size?: number; className?: string; plain?: boolean }) {
  const model = MODEL_BY_ID[modelId]
  if (!model) return <span className={cn("inline-flex size-7 items-center justify-center rounded-lg border border-line bg-ink-2 text-[10px] text-text-3", className)}>?</span>
  return <ProviderLogo provider={model.providerId} size={size} className={className} plain={plain} />
}

export function ModelTag({ modelId, className, size = "sm" }: { modelId: string; className?: string; size?: "xs" | "sm" }) {
  const model = MODEL_BY_ID[modelId]
  if (!model) return <span className={cn("mono text-xs text-text-3", className)}>{modelId || "unrouted"}</span>
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-text-1", size === "xs" ? "text-[11px]" : "text-xs", className)}>
      <ModelLogo modelId={modelId} size={size === "xs" ? 11 : 13} plain className="!size-4" />
      <span className="font-medium">{model.displayName}</span>
    </span>
  )
}
