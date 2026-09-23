import type { SubtaskKind } from "./models"

export type ExecutionMode = "sequential" | "parallel" | "staged"

export type CostMode = "economy" | "balanced" | "max-quality" | "local-first" | "zero-api"

export const COST_MODES: readonly CostMode[] = [
  "economy",
  "balanced",
  "max-quality",
  "local-first",
  "zero-api",
] as const

export const COST_MODE_LABELS: Record<CostMode, string> = {
  economy: "Economy",
  balanced: "Balanced",
  "max-quality": "Maximum Quality",
  "local-first": "Local First",
  "zero-api": "Zero-API Mode",
}

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
  /** Why this attempt happened: first try, retry after failure, or fallback to another model. */
  cause: "initial" | "retry" | "fallback" | "escalation"
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
  /** Rough size, drives estimates and simulated durations. */
  weight: 1 | 2 | 3
  progress: number
  lastUpdate: number
}

export interface RunEstimate {
  tokens: number
  costUsd: number
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
  actual?: { tokens: number; costUsd: number }
  createdAt: number
  startedAt?: number
  finishedAt?: number
}
