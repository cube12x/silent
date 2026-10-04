import type { Blueprint } from "@/domain"
import type { SilentCodeRun as Run } from "@/domain"
import type { HostLoad, LoadLevel } from "@/engine/loadGuard"

/** What `silent status` / `silent wait` read: a small, stable mirror of the app state (2026-10-04). */
export interface StatusSnapshot {
  at: number
  host?: { load1: number; cpus: number; swapUsedPct?: number; level: LoadLevel }
  pendingUpdate: string | null
  blueprints: Array<{ id: string; name: string; nodes: Array<{ id: string; title: string; type: string; status: string; note?: string; tokens?: number }> }>
  runs: Array<{ id: string; status: string; done: number; total: number; tokens: number; createdAt: number }>
}

export function buildStatusSnapshot(i: { blueprints: Blueprint[]; runs: Run[]; host?: { load: HostLoad; level: LoadLevel }; pendingUpdate: string | null; now?: number }): StatusSnapshot {
  return {
    at: i.now ?? Date.now(),
    host: i.host ? { load1: i.host.load.load1, cpus: i.host.load.cpus, swapUsedPct: i.host.load.swapUsedPct, level: i.host.level } : undefined,
    pendingUpdate: i.pendingUpdate,
    blueprints: i.blueprints.map((b) => ({
      id: b.id,
      name: b.name,
      nodes: b.nodes.map((n) => ({
        id: n.id,
        title: ("title" in n.data && typeof n.data.title === "string" && n.data.title) || n.type,
        type: n.type,
        status: n.status ?? "idle",
        note: n.note,
        tokens: n.data.type === "ai" ? n.data.tokens : undefined,
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
  }
}

/** Nothing is executing: no blueprint box has a stop handle and no run is planning/running. */
export function isIdle(i: { running: Record<string, unknown>; runs: Run[] }): boolean {
  return Object.keys(i.running).length === 0 && !i.runs.some((r) => r.status === "running")
}
