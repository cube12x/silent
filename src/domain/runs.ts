import type { SubtaskKind } from "./models"

export type ExecutionMode = "sequential" | "parallel" | "staged"

export type CostMode = "economy" | "balanced" | "max-quality"

export const COST_MODES: readonly CostMode[] = ["economy", "balanced", "max-quality"] as const

export type WorkerState =
  | "planning"
  | "thinking"
  | "coding"
  | "testing"
  | "reviewing"
  | "waiting"
  | "blocked"
  | "completed"
  | "failed"

export const TERMINAL_STATES: readonly WorkerState[] = ["completed", "failed"] as const

export function isTerminalState(state: WorkerState): boolean {
  return TERMINAL_STATES.includes(state)
}

export type RunStatus = "draft" | "planned" | "running" | "completed" | "failed" | "cancelled"

export interface RoutingDecision {
  subtaskId: string
  kind: SubtaskKind
  primaryModelId: string
  fallbackModelIds: string[]
  /** Human-readable reasoning for the routing card. */
  reason: string
  score: number
}

export interface Attempt {
  n: number
  modelId: string
  startedAt: number
  finishedAt?: number
  outcome: "success" | "failure" | "cancelled" | "running"
  error?: string
  /** Why this attempt happened: first try, retry after failure, continuation of a timed-out session, or fallback to another model. */
  cause: "initial" | "retry" | "continue" | "fallback" | "escalation"
  /** CLI session id, kept so a timed-out attempt can be resumed. */
  sessionId?: string
}

export interface TerminalLine {
  ts: number
  stream: "stdout" | "stderr" | "system"
  text: string
}

export interface Subtask {
  id: string
  runId: string
  kind: SubtaskKind
  title: string
  description: string
  dependsOn: string[]
  state: WorkerState
  assignedModelId?: string
  attempts: Attempt[]
  files: string[]
  commands: string[]
  summary?: string
  /** Rough size, drives estimates and default timeouts. */
  weight: 1 | 2 | 3
  progress: number
  lastUpdate: number
  /** Manual overrides from the plan editor. */
  effort?: Effort
  timeoutSecs?: number
}

export type Effort = "low" | "medium" | "high" | "xhigh"

export interface RunEstimate {
  tokens: number
  seconds: number
}

export interface SilentCodeRun {
  id: string
  title: string
  prompt: string
  repoAgentId?: string
  repoPath?: string
  modelPool: string[]
  executionMode: ExecutionMode
  costMode: CostMode
  plan: Subtask[]
  routing: RoutingDecision[]
  status: RunStatus
  estimate: RunEstimate
  /** True when the user edited the plan/assignments by hand. */
  manual?: boolean
  actual?: { tokens: number; costUsd: number }
  createdAt: number
  startedAt?: number
  finishedAt?: number
}
