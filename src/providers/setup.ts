import type { ProviderId } from "@/domain"
import { PROVIDERS } from "./registry"

/** The CLIs the first-run screen recommends, in order. */
export const RECOMMENDED_PROVIDERS: ProviderId[] = ["codex", "claude", "kimi", "grok", "antigravity"]

export function isPlannerCapable(id: ProviderId): boolean {
  return Boolean(PROVIDERS[id]?.capabilities.planner)
}

/** Ready = at least one planner-capable CLI (Codex or Claude Code) is installed; chat works without, orchestration does not. */
export function setupReady(installed: Iterable<ProviderId>): boolean {
  for (const id of installed) if (isPlannerCapable(id)) return true
  return false
}

export interface SetupGateInput {
  detecting: boolean
  lastDetectedAt?: number
  lastError?: string
  installedCount: number
  setupCompletedAt?: number
  pathname: string
}

/** Send a fresh machine to /setup once detection finished with zero CLIs, until the user completes or skips it. */
export function shouldOpenSetup(i: SetupGateInput): boolean {
  if (i.setupCompletedAt) return false
  if (i.detecting || !i.lastDetectedAt || i.lastError) return false
  if (i.installedCount > 0) return false
  return !i.pathname.startsWith("/setup")
}
