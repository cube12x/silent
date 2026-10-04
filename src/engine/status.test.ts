import { describe, expect, it } from "vitest"
import type { Blueprint, SilentCodeRun as Run } from "@/domain"
import { buildStatusSnapshot, isIdle } from "./status"

const bp: Blueprint = {
  id: "b1",
  name: "Minecraft",
  createdAt: 0,
  updatedAt: 0,
  nodes: [
    { id: "a", type: "ai", x: 0, y: 0, status: "done", data: { type: "ai", modelRef: "claude:sonnet", mode: "lite", title: "Bölücü 9", tokens: 12 } },
    { id: "c", type: "check", x: 0, y: 0, data: { type: "check", commands: [], maxLines: 40, timeoutSecs: 60 } },
  ],
  edges: [],
}
const run = { id: "r1", status: "running", createdAt: 5, plan: [{ state: "completed", tokens: 3 }, { state: "running", tokens: 2 }] } as unknown as Run

describe("status snapshot for `silent status` / `silent wait` (2026-10-04)", () => {
  it("mirrors boxes (title or type, status, note, tokens) and run progress", () => {
    const s = buildStatusSnapshot({ blueprints: [bp], runs: [run], pendingUpdate: "/tmp/New.app", now: 99 })
    expect(s.at).toBe(99)
    expect(s.pendingUpdate).toBe("/tmp/New.app")
    expect(s.blueprints[0]!.nodes).toEqual([
      { id: "a", title: "Bölücü 9", type: "ai", status: "done", note: undefined, tokens: 12 },
      { id: "c", title: "check", type: "check", status: "idle", note: undefined, tokens: undefined },
    ])
    expect(s.runs[0]).toMatchObject({ id: "r1", status: "running", done: 1, total: 2, tokens: 5 })
  })
  it("isIdle is true only without stop handles and without planning/running runs", () => {
    expect(isIdle({ running: {}, runs: [] })).toBe(true)
    expect(isIdle({ running: { x: () => undefined }, runs: [] })).toBe(false)
    expect(isIdle({ running: {}, runs: [run] })).toBe(false)
    expect(isIdle({ running: {}, runs: [{ ...run, status: "completed" } as Run] })).toBe(true)
  })
})
