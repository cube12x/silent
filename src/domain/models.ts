export type { ProviderId, ProviderModel, ModelTier, ModelSource, DetectedProvider } from "./runtime"
export { PROVIDER_IDS } from "./runtime"

/** Unit of work the planner produces and the router assigns. */
export type SubtaskKind = "architecture" | "backend" | "frontend" | "algorithm" | "tests" | "review" | "integration" | "docs"

export const SUBTASK_KINDS: readonly SubtaskKind[] = ["architecture", "backend", "frontend", "algorithm", "tests", "review", "integration", "docs"] as const

/** Stable model reference used everywhere in the UI/engine: `${providerId}:${modelId}`. */
export type ModelRef = string

export function modelRef(providerId: string, modelId: string): ModelRef {
  return `${providerId}:${modelId}`
}

export function parseModelRef(ref: ModelRef): { providerId: string; modelId: string } {
  const i = ref.indexOf(":")
  return i < 0 ? { providerId: ref, modelId: "" } : { providerId: ref.slice(0, i), modelId: ref.slice(i + 1) }
}
