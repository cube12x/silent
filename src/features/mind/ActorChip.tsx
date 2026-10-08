import { cn } from "cn"
import type { MindActor } from "@/domain"
import { modelRefColor, modelRefShort } from "@/engine/mind/colors"
import { useT } from "@/i18n"

/** `● Bilinç · opus` in the provider's colour — the only place Silent shows who wrote what by colour. */
export function ActorChip({ actor, modelRef, size = "sm", className }: { actor: MindActor | "memory"; modelRef?: string; size?: "xs" | "sm"; className?: string }) {
  const t = useT()
  const color = modelRefColor(modelRef)
  const label = actor === "bilinc" ? t("mind.bilinc") : actor === "eylem" ? t("mind.eylem") : actor === "tek" ? t("mind.role.tek") : t("mind.memory")
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-none border px-1.5 font-medium", size === "xs" ? "h-5 text-[10px]" : "h-6 text-[11px]", className)} style={{ borderColor: `${color}66`, color }}>
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {label}
      {modelRef && <span className="mono font-normal opacity-80">· {modelRefShort(modelRef)}</span>}
    </span>
  )
}
