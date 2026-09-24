import type { CostMode, ModelTier, Settings, SubtaskKind } from "@/domain"
import { SUBTASK_KINDS } from "@/domain"
import { TARGET_TIER } from "./router"

/** Effective kind → tier table: the user's manual table (with auto fallback per kind) or the built-in one. */
export function effectivePolicy(settings: Settings, costMode: CostMode): Record<SubtaskKind, ModelTier> {
  const auto = TARGET_TIER[costMode]
  if (settings.routingPolicy.mode !== "manual") return auto
  const out = { ...auto }
  for (const k of SUBTASK_KINDS) {
    const row = settings.routingPolicy.table[k]
    if (row?.tier) out[k] = row.tier
  }
  return out
}
