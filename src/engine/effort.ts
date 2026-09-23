import type { CostMode, Effort, ModelTier, SubtaskKind } from "@/domain"

/**
 * Reasoning effort per subtask kind. Silent always sets it explicitly so a user's global CLI default
 * (e.g. Codex `model_reasoning_effort = "xhigh"`) never leaks into light tasks.
 */
const BASE: Record<SubtaskKind, Effort> = {
  architecture: "high",
  algorithm: "high",
  backend: "medium",
  frontend: "medium",
  integration: "low",
  tests: "low",
  review: "medium",
  docs: "low",
}

const ORDER: Effort[] = ["low", "medium", "high", "xhigh"]

function shift(e: Effort, by: number): Effort {
  return ORDER[Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(e) + by))]
}

export function effortFor(kind: SubtaskKind, costMode: CostMode, tier?: ModelTier): Effort {
  let e = BASE[kind]
  if (costMode === "economy") e = shift(e, -1)
  if (costMode === "max-quality" && (kind === "architecture" || kind === "algorithm")) e = "xhigh"
  // A fast model at high effort is wasteful; a frontier model at low effort is fine.
  if (tier === "fast" && e === "high") e = "medium"
  return e
}

/** Wall-clock limit per subtask kind (seconds). Review/docs/tests are bounded tighter. */
export function timeoutFor(kind: SubtaskKind, weight: 1 | 2 | 3): number {
  const light = kind === "docs" || kind === "tests" || kind === "review"
  if (light) return 15 * 60
  return (weight >= 3 ? 40 : weight === 2 ? 30 : 20) * 60
}
