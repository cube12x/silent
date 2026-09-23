/** Provider = an AI vendor/tool connection. Codex CLI is first-class infrastructure. */
export type ProviderId = "codex" | "claude" | "gemini" | "grok" | "glm" | "fable"

export type ProviderKind = "cli" | "api" | "local"

export type ProviderStatus = "connected" | "not-installed" | "disabled" | "error" | "simulated"

export interface Provider {
  id: ProviderId
  name: string
  kind: ProviderKind
  /** Binary name on PATH for CLI providers. */
  cliBinary?: string
  status: ProviderStatus
  version?: string
  path?: string
  enabled: boolean
  /** True when Silent can really execute through this provider (v1: Codex only). */
  executable: boolean
  description: string
}

export type ModelTier = "frontier" | "strong" | "fast" | "local"

export type LatencyClass = "slow" | "medium" | "fast"

/** Unit of work the planner produces and the router assigns. */
export type SubtaskKind =
  | "architecture"
  | "backend"
  | "frontend"
  | "algorithm"
  | "tests"
  | "review"
  | "integration"
  | "docs"

export const SUBTASK_KINDS: readonly SubtaskKind[] = [
  "architecture",
  "backend",
  "frontend",
  "algorithm",
  "tests",
  "review",
  "integration",
  "docs",
] as const

export interface Model {
  id: string
  providerId: ProviderId
  displayName: string
  shortName: string
  tier: ModelTier
  /** Kinds this model is notably good at (used for routing + UI chips). */
  strengths: SubtaskKind[]
  /** USD per 1k tokens. Zero for local models. */
  costPer1kIn: number
  costPer1kOut: number
  contextWindow: number
  latency: LatencyClass
  /** Whether this model can be executed for real in v1. */
  executable: boolean
}
