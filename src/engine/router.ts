import type { CostMode, Model, RoutingDecision, Subtask, SubtaskKind } from "@/domain"
import { MODEL_BY_ID, TIER_RANK, capabilityOf } from "./capabilities"

export interface RouteInput {
  subtasks: Subtask[]
  /** Enabled model pool (ids). Routing never picks outside this pool. */
  pool: string[]
  costMode: CostMode
  /** Explicit user overrides: kind → model id (only honoured when in pool). */
  overrides?: Partial<Record<SubtaskKind, string>>
  /** Repo agent primary model gets a small affinity bonus. */
  preferredModelId?: string
}

const COST_REFERENCE = 0.1 // $ per 1k out considered "expensive"

function costPenalty(model: Model): number {
  return Math.min(1, (model.costPer1kIn + model.costPer1kOut) / COST_REFERENCE)
}

/** Weighted score in [0,1]. Cost mode decides how much price and tier matter. */
export function scoreModel(model: Model, kind: SubtaskKind, costMode: CostMode): number {
  const cap = capabilityOf(model.id, kind)
  const cost = costPenalty(model)
  const tier = TIER_RANK[model.tier] / 3
  const local = model.providerId === "glm" || model.tier === "local" ? 1 : 0
  switch (costMode) {
    case "economy":
      return cap * 0.55 + (1 - cost) * 0.4 + local * 0.05
    case "balanced":
      return cap * 0.75 + (1 - cost) * 0.2 + tier * 0.05
    case "max-quality":
      return cap * 0.85 + tier * 0.15
    case "local-first":
      return cap * 0.4 + local * 0.5 + (1 - cost) * 0.1
    case "zero-api":
      return model.costPer1kIn === 0 && model.costPer1kOut === 0 ? cap : 0
  }
}

export function explainRoute(model: Model, kind: SubtaskKind, costMode: CostMode, override: boolean): string {
  if (override) return `Pinned by routing override for ${kind}.`
  const strong = model.strengths.includes(kind)
  const parts: string[] = []
  parts.push(strong ? `${model.displayName} is a listed strength for ${kind}` : `Best available ${kind} capability in the pool`)
  if (costMode === "economy" || costMode === "local-first") parts.push(`cost-weighted (${costMode})`)
  if (costMode === "max-quality") parts.push("quality-weighted")
  if (model.executable) parts.push("executes for real via Codex CLI")
  return parts.join("; ") + "."
}

export function routeSubtasks(input: RouteInput): RoutingDecision[] {
  const poolModels = input.pool.map((id) => MODEL_BY_ID[id]).filter((m): m is Model => Boolean(m))
  return input.subtasks.map((subtask) => {
    const override = input.overrides?.[subtask.kind]
    const ranked = poolModels
      .map((model) => {
        let score = scoreModel(model, subtask.kind, input.costMode)
        if (input.preferredModelId === model.id) score += 0.03
        return { model, score }
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)

    let primary = ranked[0]
    let usedOverride = false
    if (override && poolModels.some((m) => m.id === override)) {
      primary = ranked.find((r) => r.model.id === override) ?? primary
      usedOverride = true
    }
    if (!primary) {
      return {
        subtaskId: subtask.id,
        kind: subtask.kind,
        primaryModelId: "",
        fallbackModelIds: [],
        reason: "No enabled model satisfies this cost mode. Enable a model or change cost mode.",
        score: 0,
      }
    }
    const fallbacks = ranked.filter((r) => r.model.id !== primary.model.id).slice(0, 2).map((r) => r.model.id)
    return {
      subtaskId: subtask.id,
      kind: subtask.kind,
      primaryModelId: primary.model.id,
      fallbackModelIds: fallbacks,
      reason: explainRoute(primary.model, subtask.kind, input.costMode, usedOverride),
      score: Number(primary.score.toFixed(3)),
    }
  })
}

/** Next model to try after `failedModelId`: remaining fallbacks, then escalation to a higher tier in the pool. */
export function nextModel(decision: RoutingDecision, tried: string[], pool: string[]): { modelId: string; cause: "fallback" | "escalation" } | null {
  const fb = decision.fallbackModelIds.find((id) => !tried.includes(id))
  if (fb) return { modelId: fb, cause: "fallback" }
  const highest = Math.max(...tried.map((id) => TIER_RANK[MODEL_BY_ID[id]?.tier ?? "local"]))
  const escalation = pool
    .map((id) => MODEL_BY_ID[id])
    .filter((m): m is Model => Boolean(m) && !tried.includes(m.id) && TIER_RANK[m.tier] > highest)
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier])[0]
  return escalation ? { modelId: escalation.id, cause: "escalation" } : null
}
