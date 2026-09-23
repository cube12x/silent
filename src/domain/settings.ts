import type { SubtaskKind } from "./models"
import type { CostMode } from "./runs"
import type { AgentPermissions } from "./agents"
import { DEFAULT_PERMISSIONS } from "./agents"

export type ThemeName = "obsidian" | "graphite"

export interface Settings {
  defaultPrimaryModelId: string
  defaultFallbackModelId: string
  costMode: CostMode
  routingOverrides: Partial<Record<SubtaskKind, string>>
  theme: ThemeName
  reducedMotion: boolean
  security: {
    /** Never true in v1; Codex sandbox is capped at workspace-write. */
    allowDangerFullAccess: boolean
    redactSecrets: boolean
    requireApprovalForGitPush: boolean
  }
  defaultPermissions: AgentPermissions
  memory: {
    autoCaptureSession: boolean
    autoCaptureRepo: boolean
    retentionDays: number
  }
  repoIndex: {
    enabled: boolean
    maxFiles: number
    ignoreGlobs: string[]
  }
  logs: {
    level: "error" | "warn" | "info" | "debug"
    keepTerminalLines: number
  }
}

export const DEFAULT_SETTINGS: Settings = {
  defaultPrimaryModelId: "codex",
  defaultFallbackModelId: "claude-sonnet",
  costMode: "balanced",
  routingOverrides: {},
  theme: "obsidian",
  reducedMotion: false,
  security: {
    allowDangerFullAccess: false,
    redactSecrets: true,
    requireApprovalForGitPush: true,
  },
  defaultPermissions: DEFAULT_PERMISSIONS,
  memory: { autoCaptureSession: true, autoCaptureRepo: true, retentionDays: 90 },
  repoIndex: { enabled: false, maxFiles: 20000, ignoreGlobs: ["node_modules", "target", "dist", ".git"] },
  logs: { level: "info", keepTerminalLines: 5000 },
}
