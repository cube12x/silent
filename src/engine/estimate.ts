import type { RunEstimate, RoutingDecision, Subtask } from "@/domain"

const TOKENS_PER_WEIGHT = 6000
const SECONDS_PER_WEIGHT = 70

/** Rough token/time estimate. No cost: CLIs bill through their own subscriptions; real cost is shown only when a CLI reports it. */
export function estimateRun(plan: Subtask[], _routing: RoutingDecision[], mode: "sequential" | "parallel" | "staged"): RunEstimate {
  let tokens = 0
  let seconds = 0
  let maxOne = 0
  for (const s of plan) {
    tokens += TOKENS_PER_WEIGHT * s.weight
    const sec = SECONDS_PER_WEIGHT * s.weight
    seconds += sec
    maxOne = Math.max(maxOne, sec)
  }
  if (mode === "parallel") seconds = Math.round(seconds * 0.45 + maxOne * 0.3)
  if (mode === "staged") seconds = Math.round(seconds * 0.7)
  return { tokens, seconds }
}
