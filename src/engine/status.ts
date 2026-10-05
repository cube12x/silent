import type { Blueprint } from "@/domain"
import type { SilentCodeRun as Run } from "@/domain"
import type { HostLoad, LoadLevel } from "@/engine/loadGuard"
import { pendingSummary } from "@/engine/blueprint/model"

/** What `silent status` / `silent wait` read: a small, stable mirror of the app state (2026-10-04). */
export interface StatusSnapshot {
  at: number
  host?: { load1: number; cpus: number; swapUsedPct?: number; cpuIdlePct?: number; memPressure?: number; level: LoadLevel }
  pendingUpdate: string | null
  blueprints: Array<{ id: string; name: string; updatedAt: number; nodes: Array<{ id: string; title: string; type: string; status: string; note?: string; tokens?: number }> }>
  runs: Array<{ id: string; status: string; done: number; total: number; tokens: number; createdAt: number; stalled?: StalledTask[]; /** Ready tasks waiting for a slot because the host cap is below the run's own limit. */ waitingSlots?: { ready: number; cap: number } }>
  /** Subtasks waiting on a SILENT_QUESTION answer (`silent bp answer …`), so a stalled chain is visible from the shell. */
  blocked: Array<{ runId: string; subtaskId: string; title: string; question: string; blueprint?: string; node?: string; /** When Silent will answer it itself (ms), if auto-answer is on. */ autoAnswerAt?: number }>
  /** Tasks waiting for a quota reset because no other model in their pool can take them (2026-10-05). */
  quotaWaits: Array<{ runId: string; subtaskId: string; title: string; until: number }>
  /** Model Plus boxes waiting for the user's asset deliveries (2026-10-05). */
  waiting: Array<{ blueprint: string; blueprintId: string; node: string; nodeId: string; pending: Array<{ name: string; kind: string; frames: number; frameSize?: string; status: string }>; deliverCmd: string }>
}

/** A running subtask that has printed nothing (heartbeats aside) for `STALL_MS`. */
export interface StalledTask {
  subtaskId: string
  title: string
  sinceMs: number
}
export const STALL_MS = 10 * 60_000

/** Running subtasks silent for longer than `thresholdMs`; a task without any output yet is measured from its last state change. */
export function stalledOf(run: Run, lastOutputAt: Record<string, number>, now: number, thresholdMs = STALL_MS): StalledTask[] {
  const active = new Set(["planning", "coding", "testing", "reviewing", "running"])
  return run.plan
    .filter((s) => active.has(s.state))
    .map((s) => ({ subtaskId: s.id, title: s.title, sinceMs: now - (lastOutputAt[s.id] ?? s.lastUpdate ?? now) }))
    .filter((s) => s.sinceMs >= thresholdMs)
}

export function buildStatusSnapshot(i: { blueprints: Blueprint[]; runs: Run[]; host?: { load: HostLoad; level: LoadLevel }; pendingUpdate: string | null; now?: number; lastOutputAt?: Record<string, number>; autoAnswerMs?: number }): StatusSnapshot {
  const now = i.now ?? Date.now()
  return {
    at: now,
    host: i.host ? { load1: i.host.load.load1, cpus: i.host.load.cpus, swapUsedPct: i.host.load.swapUsedPct, cpuIdlePct: i.host.load.cpuIdlePct, memPressure: i.host.load.memPressure, level: i.host.level } : undefined,
    pendingUpdate: i.pendingUpdate,
    blueprints: i.blueprints.map((b) => ({
      id: b.id,
      name: b.name,
      updatedAt: b.updatedAt,
      nodes: b.nodes.map((n) => ({
        id: n.id,
        title: ("title" in n.data && typeof n.data.title === "string" && n.data.title) || n.type,
        type: n.type,
        status: n.status ?? "idle",
        note: n.note,
        tokens: n.data.type === "ai" || n.data.type === "model" ? n.data.tokens : undefined,
      })),
    })),
    runs: i.runs
      .filter((r) => r.status === "running" || Date.now() - r.createdAt < 6 * 3600_000)
      .map((r) => ({
        id: r.id,
        status: r.status,
        done: r.plan.filter((s) => s.state === "completed").length,
        total: r.plan.length,
        tokens: r.plan.reduce((a, s) => a + (s.tokens ?? 0), 0),
        createdAt: r.createdAt,
        stalled: r.status === "running" ? (() => { const st = stalledOf(r, i.lastOutputAt ?? {}, now); return st.length ? st : undefined })() : undefined,
        waitingSlots: r.status === "running" ? r.waitingSlots : undefined,
      })),
    blocked: i.runs
      .filter((r) => r.status === "running")
      .flatMap((r) => {
        // The box that owns the run, so the hint can print the CLI's real shape: `silent bp answer "<bp>" "<box>" "…"`.
        const owner = i.blueprints.flatMap((b) => b.nodes.filter((n) => n.executionId === r.id).map((n) => ({ blueprint: b.name, node: ("title" in n.data && typeof n.data.title === "string" && n.data.title) || n.id })))[0]
        return r.plan.filter((s) => s.state === "blocked").map((s) => ({ runId: r.id, subtaskId: s.id, title: s.title, question: s.question ?? "", blueprint: owner?.blueprint, node: owner?.node, autoAnswerAt: i.autoAnswerMs && s.lastUpdate ? s.lastUpdate + i.autoAnswerMs : undefined }))
      }),
    quotaWaits: i.runs
      .filter((r) => r.status === "running")
      .flatMap((r) => r.plan.filter((s) => s.waitingUntil && s.waitingUntil > now).map((s) => ({ runId: r.id, subtaskId: s.id, title: s.title, until: s.waitingUntil! }))),
    waiting: i.blueprints.flatMap((b) =>
      b.nodes
        .filter((n) => n.type === "model" && n.status === "waiting" && n.data.type === "model")
        .map((n) => {
          const title = ("title" in n.data && typeof n.data.title === "string" && n.data.title) || "Model Plus"
          const pending = n.data.type === "model" ? pendingSummary(n.data.requests) : []
          return { blueprint: b.name, blueprintId: b.id, node: title, nodeId: n.id, pending, deliverCmd: `silent bp deliver "${b.name}" "${title}" <file>` }
        }),
    ),
  }
}

/** Nothing is executing: no blueprint box has a stop handle and no run is planning/running. */
export function isIdle(i: { running: Record<string, unknown>; runs: Run[] }): boolean {
  return Object.keys(i.running).length === 0 && !i.runs.some((r) => r.status === "running")
}

/** At most this long between two status.json writes even when nothing changed (`silent wait` treats a 120 s old snapshot as a dead app). */
export const STATUS_HEARTBEAT_MS = 30_000

/**
 * Whether the status mirror must be written: the snapshot changed (compared without its `at` stamp) or the heartbeat is
 * due. 2026-10-05: an idle app serialised and wrote ~25 KB every 5 s for nothing.
 */
export function statusWriteDue(prevBody: string | undefined, nextBody: string, lastWriteAt: number, now: number): boolean {
  if (prevBody === undefined || prevBody !== nextBody) return true
  return now - lastWriteAt >= STATUS_HEARTBEAT_MS
}

/** The snapshot without the `at` stamp, for change detection. */
export function statusBody(snap: StatusSnapshot): string {
  return JSON.stringify({ ...snap, at: 0 })
}
