import type { Subtask, SubtaskKind, WorkerState } from "@/domain"

/** What a worker receives. Deliberately small so real and simulated workers stay interchangeable. */
export interface WorkerJob {
  runId: string
  subtask: Subtask
  modelId: string
  attempt: number
  /** Full brief: gateway brief + subtask description + upstream summaries. */
  brief: string
  repoPath?: string
  sandbox: "read-only" | "workspace-write"
}

/** Progress callbacks. The executor translates these into RunEvents. */
export interface WorkerSink {
  state(state: WorkerState, progress?: number): void
  log(text: string, stream?: "stdout" | "stderr" | "system"): void
  command(command: string): void
  file(path: string): void
  usage(tokens: number, costUsd: number): void
}

export interface WorkerResult {
  ok: boolean
  summary: string
  error?: string
  retryable?: boolean
}

export interface WorkerHandle {
  done: Promise<WorkerResult>
  cancel(): void
}

export interface Worker {
  readonly id: string
  supports(kind: SubtaskKind, modelId: string): boolean
  start(job: WorkerJob, sink: WorkerSink): WorkerHandle
}
