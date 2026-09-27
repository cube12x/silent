import type { CostMode, ModelTier, ProviderModel, RoutingDecision, Subtask, SubtaskKind } from "@/domain"
import { modelRef } from "@/domain"
import { ModelIndex, TIER_RANK, capabilityOf } from "./capabilities"
import { providerInfo } from "@/providers/registry"

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
  /** Honour each subtask's `modelHint` (planner's per-task choice) when it is in the pool. */
  honourHints?: boolean
  /** kind → tier table replacing TARGET_TIER[costMode] (manual policy). */
  policy?: Record<SubtaskKind, ModelTier>
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

export function scoreModel(model: ProviderModel, kind: SubtaskKind, costMode: CostMode, target?: ModelTier): number {
  const cap = capabilityOf(model, kind)
  const fit = tierFit(target ?? TARGET_TIER[costMode][kind], model.tier)
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
  const assigned = new Map<string, number>()
  return input.subtasks.map((subtask) => {
    const override = input.overrides?.[subtask.kind]
    // A task that must drive a real browser cannot run inside a sandbox that forbids launching one.
    const browserOk = poolModels.filter((m) => providerInfo(m.providerId).capabilities.browser)
    // A pool without any browser-capable CLI (e.g. a Blueprint node pinned to Astra) still gets its browser task
    // done: escalate to a browser-capable model from the catalog rather than sending it into a sandbox that cannot.
    const catalogBrowser = browserOk.length ? browserOk : input.models.filter((m) => providerInfo(m.providerId).capabilities.browser)
    const candidates = subtask.needsBrowser && catalogBrowser.length ? catalogBrowser : poolModels
    const ranked = candidates
      .map((model) => {
        const ref = modelRef(model.providerId, model.id)
        let score = scoreModel(model, subtask.kind, input.costMode, subtask.tierHint ?? input.policy?.[subtask.kind])
        if (input.preferredModelRef === ref) score += 0.03
        return { model, ref, score }
      })
      // Equal scores: prefer the model with fewer assignments so a cheap pool shares the work.
      .sort((a, b) => b.score - a.score || (assigned.get(a.ref) ?? 0) - (assigned.get(b.ref) ?? 0))

    let primary = ranked[0]
    let usedOverride = false
    let usedHint = false
    if (override && ranked.some((r) => r.ref === override)) {
      primary = ranked.find((r) => r.ref === override) ?? primary
      usedOverride = true
    } else if (input.honourHints !== false && subtask.modelHint && ranked.some((r) => r.ref === subtask.modelHint)) {
      primary = ranked.find((r) => r.ref === subtask.modelHint) ?? primary
      usedHint = true
    }
    if (!primary) return { subtaskId: subtask.id, kind: subtask.kind, primaryModelId: "", fallbackModelIds: [], reason: "no-model", score: 0 }
    assigned.set(primary.ref, (assigned.get(primary.ref) ?? 0) + 1)
    // Prefer a fallback on a *different* CLI first so a broken CLI does not take the whole chain down.
    const others = ranked.filter((r) => r.ref !== primary.ref)
    const diffCli = others.find((r) => r.model.providerId !== primary.model.providerId)
    const fallbacks = Array.from(new Set([diffCli?.ref, ...others.map((r) => r.ref)].filter((x): x is string => Boolean(x)))).slice(0, 2)
    return {
      subtaskId: subtask.id,
      kind: subtask.kind,
      primaryModelId: primary.ref,
      fallbackModelIds: fallbacks,
      reason: usedHint ? `AI planner chose ${primary.model.displayName} for this task.` : explainRoute(primary.model, subtask.kind, input.costMode, usedOverride),
      score: Number(primary.score.toFixed(3)),
    }
  })
}

/** Next model to try after failures: remaining fallbacks, then escalation to a higher tier in the pool. */
export function nextModel(decision: RoutingDecision, tried: string[], pool: string[], models: ProviderModel[], needsBrowser = false): { modelId: string; cause: "fallback" | "escalation" } | null {
  const index = new ModelIndex(models)
  // A browser-driving task must stay on CLIs whose sandbox can launch one (2026-09-25: a play-test task
  // escalated to Codex after three Claude sessions and could not open Chromium).
  const allowed = (ref: string) => !needsBrowser || providerInfo((index.get(ref)?.providerId ?? ref.split(":")[0]) as ProviderModel["providerId"]).capabilities.browser
  const fb = decision.fallbackModelIds.find((id) => !tried.includes(id) && allowed(id))
  if (fb) return { modelId: fb, cause: "fallback" }
  const highest = Math.max(-1, ...tried.map((ref) => TIER_RANK[index.get(ref)?.tier ?? "fast"]))
  const escalation = pool
    .map((ref) => ({ ref, model: index.get(ref) }))
    .filter((x): x is { ref: string; model: ProviderModel } => Boolean(x.model) && !tried.includes(x.ref) && allowed(x.ref) && TIER_RANK[x.model!.tier] > highest)
    .sort((a, b) => TIER_RANK[b.model.tier] - TIER_RANK[a.model.tier])[0]
  return escalation ? { modelId: escalation.ref, cause: "escalation" } : null
}
