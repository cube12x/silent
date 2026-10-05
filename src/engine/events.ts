import type { Subtask, Attempt, RunReport, RunStatus, TerminalLine, WorkerState } from "@/domain"

/** Everything the executor tells the outside world. Stores subscribe; UI never talks to workers directly. */
export type RunEvent =
  | { type: "run.started"; runId: string; at: number }
  | { type: "run.status"; runId: string; status: RunStatus; at: number }
  | { type: "subtask.state"; runId: string; subtaskId: string; state: WorkerState; progress?: number; at: number; /** Why it failed (state "failed"): persisted on the last attempt. */ error?: string }
  | { type: "subtask.assigned"; runId: string; subtaskId: string; modelId: string; attempt: Attempt; at: number }
  | { type: "subtask.retry"; runId: string; subtaskId: string; modelId: string; attempt: number; reason: string; at: number }
  | { type: "subtask.fallback"; runId: string; subtaskId: string; fromModelId: string; toModelId: string; cause: "fallback" | "escalation" | "handover"; reason: string; at: number }
  | { type: "subtask.summary"; runId: string; subtaskId: string; summary: string; at: number }
  | { type: "subtask.question"; runId: string; subtaskId: string; question: string; at: number }
  | { type: "subtask.answered"; runId: string; subtaskId: string; answer: string; at: number }
  | { type: "subtask.deviations"; runId: string; subtaskId: string; deviations: string[]; notes?: string[]; at: number }
  | { type: "subtask.session"; runId: string; subtaskId: string; sessionId: string; at: number }
  | { type: "run.report"; runId: string; report: RunReport; at: number }
  | { type: "subtask.added"; runId: string; subtask: Subtask; at: number }
  | { type: "worker.log"; runId: string; subtaskId: string; line: TerminalLine }
  | { type: "worker.command"; runId: string; subtaskId: string; command: string; at: number }
  | { type: "worker.file"; runId: string; subtaskId: string; path: string; at: number }
  | { type: "worker.usage"; runId: string; subtaskId: string; tokens: number; costUsd: number; at: number }
  | { type: "run.completed"; runId: string; at: number }
  | { type: "run.failed"; runId: string; reason: string; at: number }
  | { type: "run.cancelled"; runId: string; at: number }

export type RunEventListener = (event: RunEvent) => void

export class EventBus {
  private listeners = new Set<RunEventListener>()

  subscribe(listener: RunEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: RunEvent): void {
    for (const l of Array.from(this.listeners)) l(event)
  }
}
