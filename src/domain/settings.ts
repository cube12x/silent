import type { SubtaskKind } from "./models"
import type { CostMode, Effort } from "./runs"
import type { ModelTier } from "./runtime"
import type { AgentPermissions } from "./agents"
import { DEFAULT_PERMISSIONS } from "./agents"
import type { ProviderId } from "./runtime"

export type Language = "tr" | "en"

export interface CustomModel {
  id: string
  label: string
}

export interface Settings {
  language: Language
  /** Set when the first-run Setup screen was completed or skipped. */
  setupCompletedAt?: number
  /** Maker (Blueprint / Silent Code) or Mind (MindMirror): the last mode chosen on the entry screen; the sidebar switch follows it. */
  mode?: "maker" | "mind"
  /** Projects/blueprint builds root; empty = ~/CubeCode. */
  workspaceDir?: string
  /** ModelRef `provider:model`. Empty until a CLI is detected. */
  defaultModelRef: string
  fallbackModelRef: string
  costMode: CostMode
  routingOverrides: Partial<Record<SubtaskKind, string>>
  /** Manual tier policy: when mode is "manual" the table replaces the built-in TARGET_TIER for routing and planning. */
  routingPolicy: { mode: "auto" | "manual"; table: Partial<Record<SubtaskKind, { tier: ModelTier; modelRef?: string; effort?: Effort; timeoutMin?: number }>> }
  /** User-added model ids per CLI (e.g. a new Codex slug or a full Claude model name). */
  customModels: Partial<Record<ProviderId, CustomModel[]>>
  enabledProviders: Partial<Record<ProviderId, boolean>>
  reducedMotion: boolean
  security: {
    allowDangerFullAccess: boolean
    redactSecrets: boolean
    requireApprovalForGitPush: boolean
  }
  defaultPermissions: AgentPermissions
  logs: {
    level: "error" | "warn" | "info" | "debug"
    keepTerminalLines: number
  }
  /** Warm sessions (Faz 3): a new orchestration task resumes the previous task's finished session on the same model (default on; ceiling 120k tokens per session). */
  warmSessions?: boolean
  /** Model dosage (2026-10-01): how much of each CLI's quota Silent may use; routing, planning and handover order follow it. Missing = high. */
  providerDosage?: Partial<Record<ProviderId, Dosage>>
  /** Minutes a worker's SILENT_QUESTION may wait before Silent answers it with "decide yourself, document it" (0 = never; default 10). 2026-10-05: questions waited 37–44 min with nobody at the screen. */
  autoAnswerAfterMin?: number
  /** When no browser-capable model is left in a run's pool (quota, auth), use one from the catalog (e.g. Claude) instead of waiting for the reset. Off by default: it can cost more than the pool the user chose. */
  browserFallbackOutsidePool?: boolean
}
export type Dosage = "none" | "minimal" | "low" | "medium" | "high"
export const DOSAGE_LEVELS: Dosage[] = ["none", "minimal", "low", "medium", "high"]

export const DEFAULT_SETTINGS: Settings = {
  language: "tr",
  mode: "maker",
  defaultModelRef: "",
  fallbackModelRef: "",
  costMode: "balanced",
  routingOverrides: {},
  routingPolicy: { mode: "auto", table: {} },
  customModels: {},
  enabledProviders: {},
  reducedMotion: false,
  security: { allowDangerFullAccess: false, redactSecrets: true, requireApprovalForGitPush: true },
  defaultPermissions: DEFAULT_PERMISSIONS,
  logs: { level: "info", keepTerminalLines: 5000 },
  warmSessions: true,
  autoAnswerAfterMin: 10,
}
