import type { Model, Provider, ProviderId, SubtaskKind } from "@/domain"

/**
 * Provider catalog. Codex CLI is the only provider Silent executes for real in v1;
 * the others are represented honestly as "simulated" until their CLIs/APIs are wired.
 */
export const PROVIDERS: Provider[] = [
  {
    id: "codex",
    name: "Codex CLI",
    kind: "cli",
    cliBinary: "codex",
    status: "not-installed",
    enabled: true,
    executable: true,
    description: "OpenAI Codex CLI. Core execution infrastructure: non-interactive `codex exec` with JSONL event streaming, sandboxed shell, thread resume.",
  },
  {
    id: "claude",
    name: "Claude",
    kind: "cli",
    cliBinary: "claude",
    status: "simulated",
    enabled: true,
    executable: false,
    description: "Anthropic Claude (Opus / Sonnet). Heavy coding, architecture, deep review.",
  },
  {
    id: "gemini",
    name: "Gemini",
    kind: "cli",
    cliBinary: "gemini",
    status: "simulated",
    enabled: true,
    executable: false,
    description: "Google Gemini. Large-context test generation and documentation.",
  },
  {
    id: "grok",
    name: "Grok",
    kind: "api",
    status: "simulated",
    enabled: false,
    executable: false,
    description: "xAI Grok. Fast exploratory reasoning.",
  },
  {
    id: "glm",
    name: "GLM",
    kind: "local",
    status: "simulated",
    enabled: true,
    executable: false,
    description: "Zhipu GLM, local or cheap. Docs, glue code, low-cost tasks.",
  },
  {
    id: "fable",
    name: "Fable UltraCode",
    kind: "api",
    status: "simulated",
    enabled: true,
    executable: false,
    description: "Mythos-class model tier for very large algorithmic and systems work.",
  },
]

export const MODELS: Model[] = [
  {
    id: "claude-opus",
    providerId: "claude",
    displayName: "Claude Opus",
    shortName: "Opus",
    tier: "frontier",
    strengths: ["architecture", "review", "backend"],
    costPer1kIn: 0.015,
    costPer1kOut: 0.075,
    contextWindow: 200_000,
    latency: "slow",
    executable: false,
  },
  {
    id: "claude-sonnet",
    providerId: "claude",
    displayName: "Claude Sonnet",
    shortName: "Sonnet",
    tier: "strong",
    strengths: ["backend", "frontend", "integration"],
    costPer1kIn: 0.003,
    costPer1kOut: 0.015,
    contextWindow: 200_000,
    latency: "medium",
    executable: false,
  },
  {
    id: "codex",
    providerId: "codex",
    displayName: "Codex",
    shortName: "Codex",
    tier: "strong",
    strengths: ["frontend", "integration", "backend", "review"],
    costPer1kIn: 0.002,
    costPer1kOut: 0.008,
    contextWindow: 200_000,
    latency: "medium",
    executable: true,
  },
  {
    id: "gemini",
    providerId: "gemini",
    displayName: "Gemini",
    shortName: "Gemini",
    tier: "strong",
    strengths: ["tests", "docs"],
    costPer1kIn: 0.00125,
    costPer1kOut: 0.005,
    contextWindow: 1_000_000,
    latency: "fast",
    executable: false,
  },
  {
    id: "grok",
    providerId: "grok",
    displayName: "Grok",
    shortName: "Grok",
    tier: "strong",
    strengths: ["architecture", "algorithm"],
    costPer1kIn: 0.003,
    costPer1kOut: 0.015,
    contextWindow: 256_000,
    latency: "fast",
    executable: false,
  },
  {
    id: "glm",
    providerId: "glm",
    displayName: "GLM",
    shortName: "GLM",
    tier: "local",
    strengths: ["docs", "integration"],
    costPer1kIn: 0,
    costPer1kOut: 0,
    contextWindow: 128_000,
    latency: "fast",
    executable: false,
  },
  {
    id: "fable-ultracode",
    providerId: "fable",
    displayName: "Fable UltraCode",
    shortName: "Fable",
    tier: "frontier",
    strengths: ["algorithm", "architecture"],
    costPer1kIn: 0.02,
    costPer1kOut: 0.1,
    contextWindow: 400_000,
    latency: "slow",
    executable: false,
  },
]

export const MODEL_BY_ID: Record<string, Model> = Object.fromEntries(MODELS.map((m) => [m.id, m]))
export const PROVIDER_BY_ID: Record<ProviderId, Provider> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p]),
) as Record<ProviderId, Provider>

/**
 * Capability score 0..1 of each model per subtask kind. Data, not code:
 * tune here to change routing behaviour. Missing entries default to 0.35.
 */
export const CAPABILITY: Record<string, Partial<Record<SubtaskKind, number>>> = {
  "claude-opus": { architecture: 0.98, backend: 0.9, frontend: 0.8, algorithm: 0.85, tests: 0.7, review: 0.97, integration: 0.8, docs: 0.75 },
  "claude-sonnet": { architecture: 0.8, backend: 0.92, frontend: 0.88, algorithm: 0.7, tests: 0.78, review: 0.8, integration: 0.88, docs: 0.7 },
  codex: { architecture: 0.75, backend: 0.86, frontend: 0.9, algorithm: 0.68, tests: 0.75, review: 0.82, integration: 0.9, docs: 0.7 },
  gemini: { architecture: 0.6, backend: 0.66, frontend: 0.7, algorithm: 0.6, tests: 0.93, review: 0.65, integration: 0.6, docs: 0.9 },
  grok: { architecture: 0.82, backend: 0.7, frontend: 0.6, algorithm: 0.8, tests: 0.55, review: 0.6, integration: 0.55, docs: 0.5 },
  glm: { architecture: 0.4, backend: 0.55, frontend: 0.55, algorithm: 0.45, tests: 0.5, review: 0.45, integration: 0.6, docs: 0.75 },
  "fable-ultracode": { architecture: 0.95, backend: 0.85, frontend: 0.7, algorithm: 0.99, tests: 0.7, review: 0.9, integration: 0.7, docs: 0.6 },
}

export const DEFAULT_CAPABILITY = 0.35

export function capabilityOf(modelId: string, kind: SubtaskKind): number {
  return CAPABILITY[modelId]?.[kind] ?? DEFAULT_CAPABILITY
}

export const TIER_RANK: Record<Model["tier"], number> = { local: 0, fast: 1, strong: 2, frontier: 3 }
