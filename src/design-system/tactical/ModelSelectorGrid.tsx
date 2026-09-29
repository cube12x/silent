import { cn } from "cn"
import { Check } from "lucide-react"
import type { ProviderModel } from "@/domain"
import { modelRef } from "@/domain"
import { PROVIDERS } from "@/providers/registry"
import { ModelLogo } from "./ModelLogo"
import { TacticalChip } from "./TacticalChip"

const TIER_LABEL = { frontier: "Frontier", strong: "Strong", fast: "Fast" } as const

/** Grid of real CLI models. `selected` holds ModelRefs. */
export function ModelSelectorGrid({ models, selected, onToggle, className, compact, single, unavailable = [] }: { models: ProviderModel[]; selected: string[]; onToggle: (ref: string) => void; className?: string; compact?: boolean; single?: boolean; unavailable?: string[] }) {
  return (
    <div className={cn("grid gap-2.5", compact ? "grid-cols-[repeat(auto-fill,minmax(150px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(200px,1fr))]", className)}>
      {models.map((m) => {
        const ref = modelRef(m.providerId, m.id)
        const on = selected.includes(ref)
        const info = PROVIDERS[m.providerId]
        const blocked = unavailable.includes(ref)
        return (
          <button
            key={ref}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(ref)}
            className={cn("group relative flex flex-col gap-2 rounded-md border p-3 text-left transition-colors duration-150 outline-none focus-visible:border-text-2", on ? "border-text-1 bg-ink-3" : "border-line bg-ink-2/60 hover:border-line-strong hover:bg-ink-3/60", blocked && "opacity-50")}
          >
            <div className="flex items-start justify-between gap-2">
              <ModelLogo modelRef={ref} size={compact ? 14 : 18} />
              <span className={cn("flex size-5 items-center justify-center border transition-colors", single ? "rounded-full" : "rounded-md", on ? "border-cyan bg-cyan text-[#04131a]" : "border-line-strong bg-ink-1 text-transparent group-hover:border-text-3")}>
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            </div>
            <div className="min-w-0">
              <div className={cn("truncate font-heading font-semibold text-text-1", compact ? "text-xs" : "text-sm")}>{m.displayName}</div>
              <div className="mono truncate text-[10px] text-text-3">{info.name} · {m.id}</div>
              {info.efforts && <div className="mono truncate text-[9px] text-text-3">effort {info.efforts.join(" · ")}</div>}
            </div>
            {!compact && (
              <div className="flex flex-wrap items-center gap-1">
                <TacticalChip size="xs" tone={m.tier === "frontier" ? "violet" : m.tier === "fast" ? "success" : "neutral"}>{TIER_LABEL[m.tier]}</TacticalChip>
                {m.isDefault && <TacticalChip size="xs" tone="cyan">default</TacticalChip>}
                {m.source === "custom" && <TacticalChip size="xs">custom</TacticalChip>}
                {blocked && <TacticalChip size="xs" tone="danger">unavailable</TacticalChip>}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
