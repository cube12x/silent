import type { CostMode, ModelTier, ProviderModel, RoutingDecision, Subtask, SubtaskKind } from "@/domain"
import { modelRef } from "@/domain"
import { ModelIndex, TIER_RANK, capabilityOf } from "./capabilities"

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

/**
 * Target tier per kind and cost mode. Light work goes to fast models (Haiku, GPT-6-Luna…), building
 * to strong ones (Sonnet, GPT-6-Sol…), architecture/algorithms/review to frontier.
 */
export const TARGET_TIER: Record<CostMode, Record<SubtaskKind, ModelTier>> = {
  balanced: { architecture: "frontier", algorithm: "frontier", review: "frontier", backend: "strong", frontend: "strong", integration: "strong", tests: "fast", docs: "fast" },
  economy: { architecture: "strong", algorithm: "strong", review: "strong", backend: "strong", frontend: "fast", integration: "fast", tests: "fast", docs: "fast" },
  "max-quality": { architecture: "frontier", algorithm: "frontier", review: "frontier", backend: "frontier", frontend: "frontier", integration: "strong", tests: "strong", docs: "strong" },
}

/** Distance-weighted fit: exact tier 1.0, one tier off 0.6, two off 0.25. Never zero so an odd pool still routes. */
function tierFit(target: ModelTier, actual: ModelTier): number {
  const d = Math.abs(TIER_RANK[target] - TIER_RANK[actual])
  return d === 0 ? 1 : d === 1 ? 0.6 : 0.25
}

export function scoreModel(model: ProviderModel, kind: SubtaskKind, costMode: CostMode): number {
  const cap = capabilityOf(model, kind)
  const fit = tierFit(TARGET_TIER[costMode][kind], model.tier)
  return fit * 0.7 + cap * 0.3
}

export function explainRoute(model: ProviderModel, kind: SubtaskKind, costMode: CostMode, override: boolean, lang: "tr" | "en" = "tr"): string {
  if (override) return lang === "tr" ? `${kind} için sabitlenmiş yönlendirme.` : `Pinned by routing override for ${kind}.`
  const target = TARGET_TIER[costMode][kind]
  const fit = model.tier === target ? (lang === "tr" ? "hedef katman" : "target tier") : lang === "tr" ? `en yakın katman (${target} yok)` : `nearest tier (no ${target})`
  return lang === "tr" ? `${model.displayName}: ${fit} · ${kind} kapasitesi` : `${model.displayName}: ${fit} · ${kind} capability`
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
    if (!primary) return { subtaskId: subtask.id, kind: subtask.kind, primaryModelId: "", fallbackModelIds: [], reason: "no-model", score: 0 }
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
