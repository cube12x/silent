import type { Blueprint } from "@/domain"
import type { SilentCodeRun as Run } from "@/domain"
import type { HostLoad, LoadLevel } from "@/engine/loadGuard"
import { pendingSummary } from "@/engine/blueprint/model"

/** What `silent status` / `silent wait` read: a small, stable mirror of the app state (2026-10-04). */
export interface StatusSnapshot {
  at: number
  host?: { load1: number; cpus: number; swapUsedPct?: number; level: LoadLevel }
  pendingUpdate: string | null
  blueprints: Array<{ id: string; name: string; updatedAt: number; nodes: Array<{ id: string; title: string; type: string; status: string; note?: string; tokens?: number }> }>
  runs: Array<{ id: string; status: string; done: number; total: number; tokens: number; createdAt: number }>
  /** Subtasks waiting on a SILENT_QUESTION answer (`silent bp answer …`), so a stalled chain is visible from the shell. */
  blocked: Array<{ runId: string; subtaskId: string; title: string; question: string; blueprint?: string; node?: string }>
  /** Model Plus boxes waiting for the user's asset deliveries (2026-10-05). */
  waiting: Array<{ blueprint: string; blueprintId: string; node: string; nodeId: string; pending: Array<{ name: string; kind: string; frames: number; frameSize?: string; status: string }>; deliverCmd: string }>
}

export function buildStatusSnapshot(i: { blueprints: Blueprint[]; runs: Run[]; host?: { load: HostLoad; level: LoadLevel }; pendingUpdate: string | null; now?: number }): StatusSnapshot {
  return {
    at: i.now ?? Date.now(),
    host: i.host ? { load1: i.host.load.load1, cpus: i.host.load.cpus, swapUsedPct: i.host.load.swapUsedPct, level: i.host.level } : undefined,
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
      })),
    blocked: i.runs
      .filter((r) => r.status === "running")
      .flatMap((r) => {
        // The box that owns the run, so the hint can print the CLI's real shape: `silent bp answer "<bp>" "<box>" "…"`.
        const owner = i.blueprints.flatMap((b) => b.nodes.filter((n) => n.executionId === r.id).map((n) => ({ blueprint: b.name, node: ("title" in n.data && typeof n.data.title === "string" && n.data.title) || n.id })))[0]
        return r.plan.filter((s) => s.state === "blocked").map((s) => ({ runId: r.id, subtaskId: s.id, title: s.title, question: s.question ?? "", blueprint: owner?.blueprint, node: owner?.node }))
      }),
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
