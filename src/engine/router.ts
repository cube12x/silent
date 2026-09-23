import type { CostMode, ProviderModel, RoutingDecision, Subtask, SubtaskKind } from "@/domain"
import { modelRef } from "@/domain"
import { ModelIndex, TIER_RANK, capabilityOf, priceProxy } from "./capabilities"

export interface RouteInput {
  subtasks: Subtask[]
  /** Enabled model pool as ModelRefs. Routing never picks outside this pool. */
  pool: string[]
  /** Every model the pool refs can resolve to. */
  models: ProviderModel[]
  costMode: CostMode
  /** Explicit user overrides: kind → ModelRef (only honoured when in pool). */
  overrides?: Partial<Record<SubtaskKind, string>>
  /** Agent's primary model gets a small affinity bonus. */
  preferredModelRef?: string
}

export function scoreModel(model: ProviderModel, kind: SubtaskKind, costMode: CostMode): number {
  const cap = capabilityOf(model, kind)
  const price = priceProxy(model)
  const tier = TIER_RANK[model.tier] / 2
  switch (costMode) {
    case "economy":
      return cap * 0.6 + (1 - price) * 0.4
    case "balanced":
      return cap * 0.8 + (1 - price) * 0.15 + tier * 0.05
    case "max-quality":
      return cap * 0.85 + tier * 0.15
  }
}

export function explainRoute(model: ProviderModel, kind: SubtaskKind, costMode: CostMode, override: boolean, lang: "tr" | "en" = "tr"): string {
  if (override) return lang === "tr" ? `${kind} için sabitlenmiş yönlendirme.` : `Pinned by routing override for ${kind}.`
  const parts: string[] = []
  parts.push(lang === "tr" ? `${model.displayName}: havuzdaki en yüksek ${kind} kapasitesi` : `${model.displayName}: best ${kind} capability in the pool`)
  if (costMode === "economy") parts.push(lang === "tr" ? "maliyet ağırlıklı" : "cost-weighted")
  if (costMode === "max-quality") parts.push(lang === "tr" ? "kalite ağırlıklı" : "quality-weighted")
  return parts.join(" · ")
}

export function routeSubtasks(input: RouteInput): RoutingDecision[] {
  const index = new ModelIndex(input.models)
  const poolModels = input.pool.map((ref) => index.get(ref)).filter((m): m is ProviderModel => Boolean(m))
  return input.subtasks.map((subtask) => {
    const override = input.overrides?.[subtask.kind]
    const ranked = poolModels
      .map((model) => {
        const ref = modelRef(model.providerId, model.id)
        let score = scoreModel(model, subtask.kind, input.costMode)
        if (input.preferredModelRef === ref) score += 0.03
        return { model, ref, score }
      })
      .sort((a, b) => b.score - a.score)

    let primary = ranked[0]
    let usedOverride = false
    if (override && ranked.some((r) => r.ref === override)) {
      primary = ranked.find((r) => r.ref === override) ?? primary
      usedOverride = true
    }
    if (!primary) {
      return { subtaskId: subtask.id, kind: subtask.kind, primaryModelId: "", fallbackModelIds: [], reason: "no-model", score: 0 }
    }
    // Prefer a fallback on a *different* CLI first so a broken CLI does not take the whole chain down.
    const others = ranked.filter((r) => r.ref !== primary.ref)
    const diffCli = others.find((r) => r.model.providerId !== primary.model.providerId)
    const fallbacks = Array.from(new Set([diffCli?.ref, ...others.map((r) => r.ref)].filter((x): x is string => Boolean(x)))).slice(0, 2)
    return {
      subtaskId: subtask.id,
      kind: subtask.kind,
      primaryModelId: primary.ref,
      fallbackModelIds: fallbacks,
      reason: explainRoute(primary.model, subtask.kind, input.costMode, usedOverride),
      score: Number(primary.score.toFixed(3)),
    }
  })
}

/** Next model to try after failures: remaining fallbacks, then escalation to a higher tier in the pool. */
export function nextModel(decision: RoutingDecision, tried: string[], pool: string[], models: ProviderModel[]): { modelId: string; cause: "fallback" | "escalation" } | null {
  const fb = decision.fallbackModelIds.find((id) => !tried.includes(id))
  if (fb) return { modelId: fb, cause: "fallback" }
  const index = new ModelIndex(models)
  const highest = Math.max(-1, ...tried.map((ref) => TIER_RANK[index.get(ref)?.tier ?? "fast"]))
  const escalation = pool
    .map((ref) => ({ ref, model: index.get(ref) }))
    .filter((x): x is { ref: string; model: ProviderModel } => Boolean(x.model) && !tried.includes(x.ref) && TIER_RANK[x.model!.tier] > highest)
    .sort((a, b) => TIER_RANK[b.model.tier] - TIER_RANK[a.model.tier])[0]
  return escalation ? { modelId: escalation.ref, cause: "escalation" } : null
}
