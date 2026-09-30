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
  cause: "initial" | "retry" | "continue" | "answer" | "fallback" | "escalation"
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
  /** AI planner hints. */
  tierHint?: "fast" | "strong" | "frontier"
  rationale?: string
  /** Needs a real browser; the router avoids sandboxed CLIs that cannot launch one. */
  needsBrowser?: boolean
  /** Planner's per-task model choice (`provider:model`); honoured when in the pool. */
  modelHint?: string
  /** One shell line that verifies this task's own paths (from the planner, else derived from the ownership line). */
  verify?: string
  /** Worker asked the user something and is waiting (state = blocked). */
  question?: string
  answers: string[]
  /** Things the worker reported it did differently from the request. */
  deviations: string[]
  /** Informational notes from the worker (sibling breakage, follow-ups, design decisions) — not deviations. */
  notes?: string[]
  /** Uncached tokens this subtask consumed across attempts. */
  tokens?: number
  costUsd?: number
}

export type Effort = "low" | "medium" | "high" | "xhigh"

export interface RunReport {
  done: string[]
  deviations: string[]
  notes?: string[]
  openQuestions: string[]
  finishedAt: number
  /** Polish round: reviewer score 0–10 against the spec and kit checklist, and its notes. */
  polishScore?: number
  polishNotes?: string
}

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
  planSource?: "ai" | "heuristic"
  /** Clarifying questions the planner asked and the answers given before start. */
  questions?: Array<{ id: string; question: string; why?: string; answer?: string }>
  /** Run this one continues (develop mode). */
  parentRunId?: string
  report?: RunReport
  /** English product spec written by the planner from the user's request; every worker gets it. */
  spec?: string
  /** Expert kit applied (see domain/kits). */
  kitId?: string
  /** Extra reference repositories (URLs) cloned into .silent/refs. */
  refs?: string[]
  /** Run a polish review + fix round after all subtasks complete. */
  polish?: boolean
  /** User-chosen effort for every task of this run (Blueprint AI box); absent = per-task policy. */
  effort?: Effort
  actual?: { tokens: number; costUsd: number }
  createdAt: number
  startedAt?: number
  finishedAt?: number
}
