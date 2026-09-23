import type { ProviderModel } from "@/domain"

/** Fixture models used by engine tests (shape identical to what `provider_models` returns). */
export const TEST_MODELS: ProviderModel[] = [
  { id: "gpt-6-astra", providerId: "codex", displayName: "GPT-6-Astra", source: "catalog", tier: "frontier", isDefault: true },
  { id: "gpt-5.5-mini", providerId: "codex", displayName: "GPT-5.5 mini", source: "catalog", tier: "fast" },
  { id: "opus", providerId: "claude", displayName: "Claude Opus", source: "alias", tier: "frontier" },
  { id: "sonnet", providerId: "claude", displayName: "Claude Sonnet", source: "alias", tier: "strong" },
  { id: "haiku", providerId: "claude", displayName: "Claude Haiku", source: "alias", tier: "fast" },
  { id: "k3", providerId: "kimi", displayName: "K3", source: "config", tier: "frontier" },
  { id: "kimi-for-coding-highspeed", providerId: "kimi", displayName: "K2.7 Highspeed", source: "config", tier: "fast" },
  { id: "gemini-2.5-pro", providerId: "gemini", displayName: "Gemini 2.5 Pro", source: "alias", tier: "frontier" },
]
export const TEST_POOL = TEST_MODELS.map((m) => `${m.providerId}:${m.id}`)
