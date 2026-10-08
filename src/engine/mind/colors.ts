/**
 * Provider colours used ONLY inside MindMirror (actor chips, terminal prefixes): the rest of Silent stays monochrome.
 * The user asked to see at a glance which CLI wrote what (Claude vs GPT, Gemini blue, Grok…).
 */
import type { ProviderId } from "@/domain"

const COLORS: Record<ProviderId, string> = {
  claude: "#f0a35c",
  codex: "#19c37d",
  gemini: "#4c8dff",
  grok: "#f5f5f5",
  kimi: "#b388ff",
  antigravity: "#2dd4bf",
  qwen: "#c084fc",
  opencode: "#a3a3a3",
  copilot: "#a3a3a3",
  cursor: "#a3a3a3",
  amp: "#a3a3a3",
}
const UNKNOWN = "#a3a3a3"

export function providerColor(providerId: string | undefined): string {
  if (!providerId) return UNKNOWN
  return (COLORS as Record<string, string>)[providerId] ?? UNKNOWN
}

/** `provider:model` → the provider's colour. */
export function modelRefColor(modelRef: string | undefined): string {
  return providerColor(modelRef?.split(":")[0])
}

/** Short tag for a ref (`codex:gpt-5.6-luna` → `gpt-5.6-luna`, `claude:opus` → `opus`). */
export function modelRefShort(modelRef: string | undefined): string {
  if (!modelRef) return "?"
  const i = modelRef.indexOf(":")
  return i >= 0 ? modelRef.slice(i + 1) || modelRef.slice(0, i) : modelRef
}
