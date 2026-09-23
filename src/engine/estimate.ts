import type { RunEstimate, RoutingDecision, Subtask } from "@/domain"
import { MODEL_BY_ID } from "./capabilities"

const TOKENS_PER_WEIGHT = 6000
const SECONDS_PER_WEIGHT: Record<"slow" | "medium" | "fast", number> = { slow: 95, medium: 60, fast: 35 }

export function estimateRun(plan: Subtask[], routing: RoutingDecision[], mode: "sequential" | "parallel" | "staged"): RunEstimate {
  let tokens = 0
  let costUsd = 0
  let seconds = 0
  let maxParallel = 0
  for (const s of plan) {
    const r = routing.find((x) => x.subtaskId === s.id)
    const model = r ? MODEL_BY_ID[r.primaryModelId] : undefined
    const t = TOKENS_PER_WEIGHT * s.weight
    tokens += t
    if (model) costUsd += (t / 1000) * ((model.costPer1kIn + model.costPer1kOut) / 2)
    const sec = SECONDS_PER_WEIGHT[model?.latency ?? "medium"] * s.weight
    seconds += sec
    maxParallel = Math.max(maxParallel, sec)
  }
  if (mode === "parallel") seconds = Math.round(seconds * 0.45 + maxParallel * 0.3)
  if (mode === "staged") seconds = Math.round(seconds * 0.7)
  return { tokens, costUsd: Number(costUsd.toFixed(2)), seconds }
}
