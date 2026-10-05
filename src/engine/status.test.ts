import { describe, expect, it } from "vitest"
import type { Blueprint, SilentCodeRun as Run } from "@/domain"
import { STATUS_HEARTBEAT_MS, buildStatusSnapshot, isIdle, stalledOf, statusBody, statusWriteDue } from "./status"

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
    expect(s.blueprints[0]!.updatedAt).toBe(0)
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

describe("blocked questions are visible in `silent status` (2026-10-04)", () => {
  it("lists every blocked subtask with its question, run and title", () => {
    const blocked = {
      id: "r2",
      status: "running",
      createdAt: 5,
      plan: [{ id: "t1", title: "Portal", state: "blocked", question: "Which dimension id?" }, { id: "t2", title: "Jump", state: "running" }],
    } as unknown as Run
    const s = buildStatusSnapshot({ blueprints: [], runs: [blocked], pendingUpdate: null, now: 99 })
    expect(s.blocked).toEqual([{ runId: "r2", subtaskId: "t1", title: "Portal", question: "Which dimension id?" }])
    expect(buildStatusSnapshot({ blueprints: [], runs: [run], pendingUpdate: null }).blocked).toEqual([])
  })
})

describe("Model Plus waiting boxes and blocked owners in the snapshot (2026-10-05)", () => {
  it("lists waiting model boxes with their open requests and a deliver command; blocked entries name the owning box", () => {
    const model: Blueprint = {
      ...bp,
      id: "b2",
      name: "Mario",
      nodes: [
        { id: "m", type: "model", x: 0, y: 0, status: "waiting", data: { type: "model", title: "Model Plus", modelRef: "claude:sonnet", folder: "assets/model-plus", tokens: 7, requests: [
          { id: "mr_mario", name: "mario", kind: "sprite-sheet", subject: "Mario", animations: [{ name: "walk", frames: 8 }, { name: "jump", frames: 4 }], frameSize: "64x64", sheetPrompt: "x", target: "assets/model-plus/mario", status: "pending" },
          { id: "mr_coin", name: "coin", kind: "audio", subject: "coin", sheetPrompt: "x", target: "assets/model-plus/coin", status: "accepted" },
        ] } },
        { id: "owner", type: "ai", x: 0, y: 0, status: "running", executionId: "r2", data: { type: "ai", modelRef: "claude:sonnet", mode: "lite", title: "Bölücü 4C" } },
      ],
    }
    const blockedRun = { id: "r2", status: "running", createdAt: 5, plan: [{ id: "t1", title: "Portal", state: "blocked", question: "Which id?" }] } as unknown as Run
    const s = buildStatusSnapshot({ blueprints: [model], runs: [blockedRun], pendingUpdate: null, now: 99 })
    expect(s.waiting).toEqual([{ blueprint: "Mario", blueprintId: "b2", node: "Model Plus", nodeId: "m", pending: [{ name: "mario", kind: "sprite-sheet", frames: 12, frameSize: "64x64", status: "pending" }], deliverCmd: 'silent bp deliver "Mario" "Model Plus" <file>' }])
    expect(s.blocked[0]).toMatchObject({ runId: "r2", subtaskId: "t1", blueprint: "Mario", node: "Bölücü 4C" })
    expect(s.blueprints[0]!.nodes[0]).toMatchObject({ type: "model", status: "waiting", tokens: 7 })
  })
})

describe("status.json is written only on change or heartbeat (2026-10-05 perf)", () => {
  it("statusWriteDue: first write, changes and the 30 s heartbeat", () => {
    const a = buildStatusSnapshot({ blueprints: [bp], runs: [], pendingUpdate: null, now: 1 })
    const b = buildStatusSnapshot({ blueprints: [bp], runs: [], pendingUpdate: null, now: 2 })
    expect(statusBody(a)).toBe(statusBody(b)) // `at` is not a change
    expect(statusWriteDue(undefined, statusBody(a), 0, 1000)).toBe(true)
    expect(statusWriteDue(statusBody(a), statusBody(b), 1000, 6000)).toBe(false)
    expect(statusWriteDue(statusBody(a), statusBody(b), 1000, 1000 + STATUS_HEARTBEAT_MS)).toBe(true)
    const c = buildStatusSnapshot({ blueprints: [bp], runs: [], pendingUpdate: "/tmp/New.app", now: 3 })
    expect(statusWriteDue(statusBody(a), statusBody(c), 1000, 2000)).toBe(true)
  })
})

describe("stalled tasks and the auto-answer countdown (2026-10-05 terminal review)", () => {
  const running = { id: "r9", status: "running", createdAt: 5, plan: [
    { id: "a", title: "Playwright smoke", state: "testing", lastUpdate: 1_000_000 },
    { id: "b", title: "Fast task", state: "coding", lastUpdate: 1_000_000 },
    { id: "c", title: "Done task", state: "completed", lastUpdate: 1_000_000 },
    { id: "q", title: "Portal", state: "blocked", question: "Which id?", lastUpdate: 1_500_000 },
  ] } as unknown as Run
  it("stalledOf flags running tasks silent for 10 min (last output or last state change), never finished ones", () => {
    const now = 1_000_000 + 11 * 60_000
    expect(stalledOf(running, { b: now - 1000 }, now)).toEqual([{ subtaskId: "a", title: "Playwright smoke", sinceMs: 11 * 60_000 }])
    expect(stalledOf(running, { a: now - 1000, b: now - 1000 }, now)).toEqual([])
  })
  it("the snapshot carries stalled[] on the run and autoAnswerAt on blocked entries", () => {
    const now = 1_000_000 + 11 * 60_000
    const s = buildStatusSnapshot({ blueprints: [], runs: [running], pendingUpdate: null, now, lastOutputAt: { b: now }, autoAnswerMs: 10 * 60_000 })
    expect(s.runs[0]!.stalled).toEqual([{ subtaskId: "a", title: "Playwright smoke", sinceMs: 11 * 60_000 }])
    expect(s.blocked[0]).toMatchObject({ subtaskId: "q", autoAnswerAt: 1_500_000 + 10 * 60_000 })
    expect(buildStatusSnapshot({ blueprints: [], runs: [running], pendingUpdate: null, now, autoAnswerMs: 0 }).blocked[0]!.autoAnswerAt).toBeUndefined()
  })
})

describe("host-capped runs show their waiting slots (2026-10-05)", () => {
  it("waitingSlots is mirrored for running runs; the host line carries cpu idle and pressure", () => {
    const capped = { id: "r7", status: "running", createdAt: 5, plan: [], waitingSlots: { ready: 2, cap: 1 } } as unknown as Run
    const s = buildStatusSnapshot({ blueprints: [], runs: [capped], pendingUpdate: null, now: 10, host: { load: { load1: 5.5, cpus: 6, swapUsedPct: 88, cpuIdlePct: 52, memPressure: 2 }, level: "ok" } })
    expect(s.runs[0]!.waitingSlots).toEqual({ ready: 2, cap: 1 })
    expect(s.host).toMatchObject({ cpuIdlePct: 52, memPressure: 2, level: "ok" })
  })
})
