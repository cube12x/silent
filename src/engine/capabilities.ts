import type { ModelTier, ProviderId, ProviderModel, SubtaskKind } from "@/domain"
import { modelRef } from "@/domain"

/**
 * Per-CLI capability scores 0..1 per subtask kind. Data, not code. A model inherits its CLI's row
 * and gets a tier bonus; the router only ever sees models of installed + enabled CLIs.
 */
export const PROVIDER_CAPABILITY: Record<ProviderId, Record<SubtaskKind, number>> = {
  claude: { architecture: 0.97, backend: 0.92, frontend: 0.88, algorithm: 0.85, tests: 0.8, review: 0.96, integration: 0.86, docs: 0.82 },
  codex: { architecture: 0.82, backend: 0.9, frontend: 0.92, algorithm: 0.78, tests: 0.8, review: 0.85, integration: 0.92, docs: 0.75 },
  kimi: { architecture: 0.8, backend: 0.84, frontend: 0.8, algorithm: 0.86, tests: 0.78, review: 0.78, integration: 0.78, docs: 0.76 },
  grok: { architecture: 0.84, backend: 0.8, frontend: 0.74, algorithm: 0.85, tests: 0.7, review: 0.72, integration: 0.72, docs: 0.66 },
  gemini: { architecture: 0.74, backend: 0.76, frontend: 0.78, algorithm: 0.72, tests: 0.9, review: 0.7, integration: 0.7, docs: 0.9 },
  antigravity: { architecture: 0.74, backend: 0.76, frontend: 0.78, algorithm: 0.72, tests: 0.9, review: 0.7, integration: 0.7, docs: 0.9 },
  qwen: { architecture: 0.68, backend: 0.78, frontend: 0.74, algorithm: 0.74, tests: 0.76, review: 0.66, integration: 0.7, docs: 0.72 },
  opencode: { architecture: 0.72, backend: 0.78, frontend: 0.76, algorithm: 0.7, tests: 0.72, review: 0.7, integration: 0.74, docs: 0.7 },
  copilot: { architecture: 0.7, backend: 0.78, frontend: 0.8, algorithm: 0.66, tests: 0.76, review: 0.72, integration: 0.74, docs: 0.72 },
  cursor: { architecture: 0.74, backend: 0.8, frontend: 0.84, algorithm: 0.7, tests: 0.74, review: 0.74, integration: 0.78, docs: 0.7 },
  amp: { architecture: 0.74, backend: 0.8, frontend: 0.78, algorithm: 0.7, tests: 0.72, review: 0.74, integration: 0.76, docs: 0.68 },
}

export const TIER_RANK: Record<ModelTier, number> = { fast: 0, strong: 1, frontier: 2 }
export const TIER_BONUS: Record<ModelTier, number> = { fast: -0.08, strong: 0, frontier: 0.06 }

export function capabilityOf(model: ProviderModel, kind: SubtaskKind): number {
  const base = PROVIDER_CAPABILITY[model.providerId]?.[kind] ?? 0.6
  return Math.max(0, Math.min(1, base + TIER_BONUS[model.tier]))
}

/** Lookup helper shared by router/executor/UI. */
export class ModelIndex {
  private byRef = new Map<string, ProviderModel>()
  constructor(models: ProviderModel[]) {
    for (const m of models) this.byRef.set(modelRef(m.providerId, m.id), m)
  }
  get(ref: string): ProviderModel | undefined {
    return this.byRef.get(ref)
  }
  all(): ProviderModel[] {
    return Array.from(this.byRef.values())
  }
  refs(): string[] {
    return Array.from(this.byRef.keys())
  }
}
