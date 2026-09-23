import * as React from "react"
import { cn } from "cn"
import { ChevronDown, Plus } from "lucide-react"
import type { ProviderId, ProviderModel } from "@/domain"
import { modelRef } from "@/domain"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ModelLogo, TacticalChip } from "@/design-system"
import { PROVIDERS } from "@/providers/registry"
import { useProvidersStore, selectAvailableModels } from "@/stores/providers"
import { useT } from "@/i18n"

/** CLI · model dropdown grouped by CLI, with a quick "add model id" row per CLI. */
export function ModelPicker({ providerId, modelId, onChange, className, size = "sm" }: { providerId: ProviderId; modelId: string; onChange: (providerId: ProviderId, modelId: string) => void; className?: string; size?: "xs" | "sm" }) {
  const t = useT()
  const providers = useProvidersStore((s) => s.providers)
  const addCustomModel = useProvidersStore((s) => s.addCustomModel)
  const models = React.useMemo(() => selectAvailableModels(providers), [providers])
  const [open, setOpen] = React.useState(false)
  const [custom, setCustom] = React.useState<{ providerId: ProviderId; value: string } | null>(null)
  const current = models.find((m) => m.providerId === providerId && m.id === modelId)
  const byProvider = models.reduce<Partial<Record<ProviderId, ProviderModel[]>>>((acc, m) => ((acc[m.providerId] ??= []).push(m), acc), {})
  const info = PROVIDERS[providerId]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn("flex items-center gap-1.5 rounded-md border border-line bg-ink-2 px-2 text-text-1 hover:border-cyan/50", size === "xs" ? "h-6 text-[11px]" : "h-7 text-xs", className)}>
          <ModelLogo modelRef={modelRef(providerId, modelId)} size={11} plain className="!size-4" />
          <span className="text-text-3">{info?.name ?? providerId}</span>
          <span className="text-text-3">·</span>
          <span className="max-w-[180px] truncate font-medium">{current?.displayName ?? modelId ?? t("common.default")}</span>
          <ChevronDown className="size-3 text-text-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] border-line bg-ink-1 p-1">
        {models.length === 0 && <div className="p-3 text-xs text-text-3">{t("modal.noModels")}</div>}
        <div className="max-h-[360px] overflow-auto">
          {(Object.keys(byProvider) as ProviderId[]).map((pid) => (
            <div key={pid} className="mb-1">
              <div className="flex items-center gap-2 px-2 py-1 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">
                <ModelLogo modelRef={pid} size={10} plain className="!size-4" />{PROVIDERS[pid].name}
                <button type="button" onClick={() => setCustom({ providerId: pid, value: "" })} className="ml-auto flex items-center gap-1 normal-case tracking-normal text-text-3 hover:text-cyan"><Plus className="size-3" />{t("settings.addModel")}</button>
              </div>
              {byProvider[pid]!.map((m) => {
                const on = m.providerId === providerId && m.id === modelId
                return (
                  <button key={m.id} type="button" onClick={() => { onChange(m.providerId, m.id); setOpen(false) }} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-ink-3", on && "bg-cyan/[0.08] text-cyan")}>
                    <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                    <span className="mono truncate text-[10px] text-text-3">{m.id}</span>
                    <TacticalChip size="xs" tone={m.tier === "frontier" ? "violet" : m.tier === "fast" ? "success" : "neutral"}>{m.tier}</TacticalChip>
                  </button>
                )
              })}
              {custom?.providerId === pid && (
                <form
                  className="flex gap-1 px-2 py-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const v = custom.value.trim()
                    if (!v) return
                    void addCustomModel(pid, v).then(() => { onChange(pid, v); setCustom(null); setOpen(false) })
                  }}
                >
                  <input autoFocus value={custom.value} onChange={(e) => setCustom({ providerId: pid, value: e.target.value })} placeholder={t("settings.modelIdPh")} className="mono h-7 min-w-0 flex-1 rounded-md border border-line bg-ink-2 px-2 text-[11px] outline-none focus:border-cyan/50" />
                  <button type="submit" className="h-7 rounded-md border border-cyan/40 px-2 text-[11px] text-cyan">{t("common.add")}</button>
                </form>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
