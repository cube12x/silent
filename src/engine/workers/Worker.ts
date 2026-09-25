import type { Effort, Subtask, SubtaskKind, WorkerState } from "@/domain"

/** What a worker receives. Deliberately small so every CLI adapter stays interchangeable. */
export interface WorkerJob {
  runId: string
  subtask: Subtask
  modelId: string
  attempt: number
  /** Full brief: gateway brief + subtask description + upstream summaries. */
  brief: string
  repoPath?: string
  sandbox: "read-only" | "workspace-write"
  /** Outbound network for the worker shell (installs). */
  network: boolean
  effort: Effort
  timeoutSecs: number
  /** Resume this CLI session instead of starting a new one (continuation after a timeout). */
  resumeSessionId?: string
}

export interface WorkerSink {
  state(state: WorkerState, progress?: number): void
  log(text: string, stream?: "stdout" | "stderr" | "system"): void
  command(command: string): void
  file(path: string): void
  usage(tokens: number, costUsd: number): void
  /** The CLI announced its session id; the executor stores it for continuations. */
  session(sessionId: string): void
}

export interface WorkerResult {
  ok: boolean
  summary: string
  error?: string
  retryable?: boolean
  /** Set when the process hit its wall-clock limit; the executor may resume the same session. */
  timedOut?: boolean
  /** The worker stopped to ask the user something (SILENT_QUESTION). */
  blocked?: boolean
  question?: string
  /** Things the worker reported doing differently from the request (SILENT_DEVIATIONS). */
  deviations?: string[]
  /** `SILENT_NOTES:` items: information, not deviations. */
  notes?: string[]
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
