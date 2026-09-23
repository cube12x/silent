import { cn } from "cn"
import { Check, Terminal } from "lucide-react"
import type { Model, Provider } from "@/domain"
import { ModelLogo } from "./ModelLogo"
import { TacticalChip } from "./TacticalChip"
import { formatUsd } from "@/lib/format"

const TIER_LABEL: Record<Model["tier"], string> = { frontier: "Frontier", strong: "Strong", fast: "Fast", local: "Local" }

export function ModelSelectorGrid({ models, providers, selected, onToggle, className, compact }: { models: Model[]; providers: Provider[]; selected: string[]; onToggle: (id: string) => void; className?: string; compact?: boolean }) {
  return (
    <div className={cn("grid gap-2.5", compact ? "grid-cols-[repeat(auto-fill,minmax(150px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(210px,1fr))]", className)}>
      {models.map((m) => {
        const provider = providers.find((p) => p.id === m.providerId)
        const on = selected.includes(m.id)
        const disabled = provider ? !provider.enabled : false
        const real = m.executable && provider?.status === "connected"
        return (
          <button
            key={m.id}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onToggle(m.id)}
            className={cn(
              "group relative flex flex-col gap-2 rounded-xl border p-3 text-left transition-all duration-200 outline-none",
              on ? "border-cyan/50 bg-cyan/[0.06] shadow-glow" : "border-line bg-ink-2/60 hover:border-line-strong hover:bg-ink-3/60",
              disabled && "cursor-not-allowed opacity-40",
              "focus-visible:border-cyan/60",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <ModelLogo modelId={m.id} size={compact ? 14 : 18} />
              <span className={cn("flex size-5 items-center justify-center rounded-md border transition-colors", on ? "border-cyan bg-cyan text-[#04131a]" : "border-line-strong bg-ink-1 text-transparent group-hover:border-text-3")}>
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            </div>
            <div className="min-w-0">
              <div className={cn("truncate font-heading font-semibold text-text-1", compact ? "text-xs" : "text-sm")}>{m.displayName}</div>
              <div className="truncate text-[11px] text-text-3">{provider?.name ?? m.providerId}</div>
            </div>
            {!compact && (
              <div className="flex flex-wrap items-center gap-1">
                <TacticalChip size="xs" tone={m.tier === "frontier" ? "violet" : m.tier === "local" ? "success" : "neutral"}>{TIER_LABEL[m.tier]}</TacticalChip>
                {real ? (
                  <TacticalChip size="xs" tone="cyan"><Terminal className="size-2.5" />CLI</TacticalChip>
                ) : (
                  <TacticalChip size="xs" tone="neutral">{provider?.status === "not-installed" ? "not installed" : "simulated"}</TacticalChip>
                )}
                <span className="mono ml-auto text-[10px] text-text-3">{m.costPer1kOut === 0 ? "free" : `${formatUsd(m.costPer1kOut)}/1k`}</span>
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
