import type { SubtaskKind } from "./models"

export interface AgentPermissions {
  read: boolean
  write: boolean
  runTests: boolean
  terminal: boolean
  gitCommit: boolean
  /** OFF by default. */
  gitPush: boolean
  network: boolean
  fileCreateDelete: boolean
}

export const DEFAULT_PERMISSIONS: AgentPermissions = {
  read: true,
  write: true,
  runTests: true,
  terminal: true,
  gitCommit: false,
  gitPush: false,
  network: false,
  fileCreateDelete: true,
}

export type PermissionKey = keyof AgentPermissions

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  read: "Read",
  write: "Write",
  runTests: "Run tests",
  terminal: "Terminal",
  gitCommit: "Git commit",
  gitPush: "Git push",
  network: "Network access",
  fileCreateDelete: "File creation/deletion",
}

export type TaskStyle = "surgical" | "balanced" | "exploratory"

export type BehaviorTrait =
  | "respect-architecture"
  | "verify-with-tests"
  | "minimal-dependencies"
  | "stability-first"
  | "clean-code"
  | "explain-decisions"
  | "security-conscious"
  | "performance-aware"
  | "no-speculative-refactors"
  | "ask-before-destructive"

/** What Silent derives from a natural-language Gateway prompt. */
export interface GatewayProfile {
  role: string
  behaviorProfile: BehaviorTrait[]
  guardrails: string[]
  contextPriority: string[]
  permissions: Partial<AgentPermissions>
  taskStyle: TaskStyle
  qualityExpectations: string[]
  /** Kinds this agent should favour when planning. */
  focusKinds: SubtaskKind[]
  /** Human-readable one-liner for cards. */
  summary: string
}

export type AgentTool = "shell" | "git" | "tests" | "file-edit" | "search" | "web"

export type AgentStatus = "idle" | "working" | "blocked" | "error"

export interface AgentAction {
  id: string
  at: number
  kind: "run" | "chat" | "commit" | "test" | "edit" | "memory"
  title: string
  detail?: string
  ok: boolean
}

export interface RepoAgent {
  id: string
  name: string
  repoPath: string
  primaryModelId: string
  fallbackModelIds: string[]
  gatewayPrompt: string
  gatewayProfile: GatewayProfile
  permissions: AgentPermissions
  toolsEnabled: AgentTool[]
  memoryCount: number
  status: AgentStatus
  lastActions: AgentAction[]
  createdAt: number
  updatedAt: number
}
