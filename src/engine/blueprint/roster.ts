import type { Subtask, WorkerState } from "@/domain"

/** One line per model under an orchestration AI node: the model and the run tasks it is (or will be) working on. */
export interface RosterRow {
  modelRef: string
  tasks: Array<{ id: string; title: string; state: WorkerState }>
}

/**
 * Group a run's tasks by model. Pool models come first in pool order (idle ones included, so the user sees who
 * has nothing yet); models the router pulled in from outside the pool follow. A task not yet assigned shows under
 * the planner's hint.
 */
export function teamRoster(plan: readonly Subtask[], pool: readonly string[]): RosterRow[] {
  const rows = new Map<string, RosterRow>()
  for (const ref of pool) if (ref && !rows.has(ref)) rows.set(ref, { modelRef: ref, tasks: [] })
  for (const st of plan) {
    const ref = st.assignedModelId || st.modelHint
    if (!ref) continue
    if (!rows.has(ref)) rows.set(ref, { modelRef: ref, tasks: [] })
    rows.get(ref)!.tasks.push({ id: st.id, title: st.title, state: st.state })
  }
  return Array.from(rows.values())
}

/** Glyph + colour class for a task state in the roster. */
export function rosterGlyph(state: WorkerState): { glyph: string; className: string } {
  switch (state) {
    case "completed":
      return { glyph: "✓", className: "text-success" }
    case "failed":
      return { glyph: "✗", className: "text-danger" }
    case "blocked":
      return { glyph: "❓", className: "text-warn" }
    case "waiting":
      return { glyph: "○", className: "text-text-3" }
    default:
      return { glyph: "●", className: "text-text-1" }
  }
}
