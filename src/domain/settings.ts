import type { SubtaskKind } from "./models"
import type { CostMode } from "./runs"
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
  /** ModelRef `provider:model`. Empty until a CLI is detected. */
  defaultModelRef: string
  fallbackModelRef: string
  costMode: CostMode
  routingOverrides: Partial<Record<SubtaskKind, string>>
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
}

export const DEFAULT_SETTINGS: Settings = {
  language: "tr",
  defaultModelRef: "",
  fallbackModelRef: "",
  costMode: "balanced",
  routingOverrides: {},
  customModels: {},
  enabledProviders: {},
  reducedMotion: false,
  security: { allowDangerFullAccess: false, redactSecrets: true, requireApprovalForGitPush: true },
  defaultPermissions: DEFAULT_PERMISSIONS,
  logs: { level: "info", keepTerminalLines: 5000 },
}
