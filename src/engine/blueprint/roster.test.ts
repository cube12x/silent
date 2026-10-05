import { describe, expect, it } from "vitest"
import type { Subtask } from "@/domain"
import { teamRoster } from "./roster"

function st(id: string, title: string, state: Subtask["state"], model?: { assigned?: string; hint?: string }): Subtask {
  return { id, runId: "r", kind: "backend", title, description: "", dependsOn: [], state, assignedModelId: model?.assigned, modelHint: model?.hint, attempts: [], files: [], commands: [], weight: 2, progress: 0, lastUpdate: 0, answers: [], deviations: [] }
}

describe("teamRoster", () => {
  const pool = ["claude:claude-fable-5-1", "kimi:kimi-code/x", "codex:gpt-5.6-luna"]
  it("lists every pool model in pool order with the tasks it was given, planned ones by hint", () => {
    const plan = [
      st("a", "Mimari", "completed", { assigned: "claude:claude-fable-5-1" }),
      st("b", "Fizik", "coding", { assigned: "kimi:kimi-code/x", hint: "codex:gpt-5.6-luna" }),
      st("c", "Silahlar", "waiting", { hint: "codex:gpt-5.6-luna" }),
      st("d", "HUD", "waiting", { hint: "kimi:kimi-code/x" }),
    ]
    expect(teamRoster(plan, pool)).toEqual([
      { modelRef: "claude:claude-fable-5-1", tasks: [{ id: "a", title: "Mimari", state: "completed" }] },
      { modelRef: "kimi:kimi-code/x", tasks: [{ id: "b", title: "Fizik", state: "coding" }, { id: "d", title: "HUD", state: "waiting" }] },
      { modelRef: "codex:gpt-5.6-luna", tasks: [{ id: "c", title: "Silahlar", state: "waiting" }] },
    ])
  })
  it("appends models the router pulled in from outside the pool, and keeps idle pool models", () => {
    const plan = [st("a", "Tarayıcı testi", "testing", { assigned: "grok:grok-4.7" })]
    expect(teamRoster(plan, pool).map((r) => [r.modelRef, r.tasks.length])).toEqual([
      ["claude:claude-fable-5-1", 0],
      ["kimi:kimi-code/x", 0],
      ["codex:gpt-5.6-luna", 0],
      ["grok:grok-4.7", 1],
    ])
  })
  it("leaves unassigned, unhinted tasks out", () => {
    expect(teamRoster([st("a", "x", "waiting")], pool).every((r) => r.tasks.length === 0)).toBe(true)
  })
})

describe("quota waits in the roster (2026-10-05)", () => {
  it("a task waiting for a quota reset carries its time and shows ⏳; a queued one stays ○", async () => {
    const { teamRoster, rosterGlyph } = await import("./roster")
    const plan = [
      { id: "a", title: "check", state: "waiting", assignedModelId: "antigravity:g", waitingUntil: 99 },
      { id: "b", title: "queued", state: "waiting", assignedModelId: "antigravity:g" },
    ] as never
    const rows = teamRoster(plan, ["antigravity:g"])
    expect(rows[0]!.tasks[0]!.waitingUntil).toBe(99)
    expect(rosterGlyph("waiting", 99).glyph).toBe("⏳")
    expect(rosterGlyph("waiting").glyph).toBe("○")
  })
})
