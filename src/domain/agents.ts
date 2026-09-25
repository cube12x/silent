import type { SubtaskKind } from "./models"
import type { ProviderId } from "./runtime"

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
  network: true,
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

/** Defaults an expert (template) agent applies to every run started with it. */
export interface RunDefaults {
  kitId?: string
  /** Model refs (`provider:model`) the run is restricted to. */
  pool?: string[]
  /** Model ref pinned to every build kind (architecture/backend/frontend/algorithm/integration). */
  prefer?: string
  costMode?: "economy" | "balanced" | "max-quality"
  polish?: boolean
  refs?: string[]
}

export interface RepoAgent {
  id: string
  name: string
  /** Empty for template (expert) agents: they are applied to whatever folder the run uses. */
  repoPath: string
  /** Expert agent: not bound to one repository; carries `runDefaults`. */
  template?: boolean
  runDefaults?: RunDefaults
  providerId: ProviderId
  modelId: string
  /** Fallback models as ModelRefs (`provider:model`). */
  fallbackModelRefs: string[]
  gatewayPrompt: string
  gatewayProfile: GatewayProfile
  permissions: AgentPermissions
  toolsEnabled: AgentTool[]
  memoryCount: number
  /** Created automatically as the expert of a finished run. */
  sourceRunId?: string
  status: AgentStatus
  lastActions: AgentAction[]
  createdAt: number
  updatedAt: number
}

/** Built-in expert agent seeded once: cheap, creative pixel-art production. */
export const PIXEL_MASTER_SEED = {
  name: "Pixel Ustası",
  providerId: "grok" as ProviderId,
  modelId: "grok-4.7-build-fast",
  gatewayPrompt:
    "You are Pixel Ustası, a pixel-art game master. Every project you touch is a finished, charming retro game: integer-scaled virtual canvas with nearest-neighbour sampling, one disciplined palette, procedurally generated sprite sheets with real animation frames, Bayer dithering and palette swaps for effects, chunky readable UI in a bitmap font, juicy feedback (hit-stop, shake, pixel particles) and synthesized chiptune audio. You study the reference engines in .silent/refs before designing and reuse their proven patterns. You work economically: small focused modules, no over-engineering, verify with unit tests and headless checks, leave browser play-testing to the integration task.",
  runDefaults: {
    kitId: "pixel-art-game",
    // No pool restriction and no pin: the planner picks the best model per task from everything enabled.
    costMode: "balanced" as const,
    polish: true,
  },
}
