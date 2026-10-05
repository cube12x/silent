import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Blueprint, SilentCodeRun } from "@/domain"
import { useBlueprintsStore } from "./blueprints"
import { useRunsStore } from "./runs"

let resumed: SilentCodeRun | undefined
const singleCalls: string[] = []
vi.mock("@/services", () => ({
  getBackend: async () => ({
    db: { blueprints: { upsert: async () => undefined }, runs: { upsert: async () => undefined } },
    projectSweep: async () => 0,
    repoDigest: async () => "",
    blueprintBuildStats: async () => ({ fileCount: 0, images: [], newestMs: 0 }),
    blueprintWriteTool: async () => "",
    blueprintBuildDir: async () => "/tmp/mario",
    cliStart: async () => { throw new Error("no cli in this test") },
  }),
}))
vi.mock("@/engine/blueprint/single", () => ({
  runSingle: (_b: unknown, req: { runId: string }) => {
    singleCalls.push(req.runId)
    return { cancel: async () => undefined, done: Promise.resolve({ ok: true, text: "done", tokens: 3, sessionId: "s" }) }
  },
}))

const run = (): SilentCodeRun =>
  ({
    id: "run_r",
    title: "r",
    prompt: "r",
    modelPool: ["codex:gpt-5.6-terra"],
    executionMode: "parallel",
    costMode: "balanced",
    status: "failed",
    routing: [],
    createdAt: 1,
    plan: [
      { id: "a", title: "built", state: "completed", tokens: 100, attempts: [], dependsOn: [], files: [], commands: [], answers: [], deviations: [], progress: 100, lastUpdate: 1 },
      { id: "b", title: "browser check", state: "failed", tokens: 10, attempts: [{ modelId: "antigravity:x", outcome: "failure" }], dependsOn: ["a"], files: [], commands: [], answers: [], deviations: [], progress: 40, lastUpdate: 1, question: "q?" },
    ],
  }) as unknown as SilentCodeRun

const bp = (): Blueprint => ({
  id: "b1",
  name: "Mario",
  nodes: [
    { id: "s", type: "button", x: 0, y: 0, data: { type: "button", kind: "start" } },
    { id: "main", type: "ai", x: 0, y: 0, status: "failed", executionId: "run_r", data: { type: "ai", modelRef: "codex:gpt-5.6-terra", mode: "orchestration", title: "Ana İnşa" } },
    { id: "pn", type: "prompt", x: 0, y: 0, data: { type: "prompt", title: "next", text: "polish it" } },
    { id: "next", type: "ai", x: 0, y: 0, data: { type: "ai", modelRef: "claude:sonnet", mode: "single", title: "Next" } },
  ],
  edges: [{ id: "e1", from: "s", to: "main" }, { id: "e2", from: "main", to: "next" }, { id: "e3", from: "pn", to: "next" }],
  createdAt: 1,
  updatedAt: 1,
})

describe("Kaldığı yerden devam (2026-10-05)", () => {
  beforeEach(() => {
    resumed = undefined
    singleCalls.length = 0
    useRunsStore.setState({
      runs: [run()],
      executors: {},
      // stand-in for the real start(): records what would run and finishes it
      start: async (r: SilentCodeRun) => {
        resumed = r
        useRunsStore.setState({ runs: [{ ...r, status: "running" }] })
        setTimeout(() => useRunsStore.setState({ runs: [{ ...r, status: "completed", plan: r.plan.map((s) => ({ ...s, state: "completed", tokens: (s.tokens ?? 0) + 5 })) }] }), 20)
      },
    } as never)
    useBlueprintsStore.setState({ logs: {}, blueprints: [bp()], running: {} })
  })
  it("runs.resume keeps finished tasks and resets only the rest", async () => {
    expect(await useRunsStore.getState().resume("run_r")).toBe(true)
    expect(resumed!.plan.map((s) => [s.id, s.state])).toEqual([["a", "completed"], ["b", "waiting"]])
    expect(resumed!.plan[1]!.question).toBeUndefined()
    expect(resumed!.plan[1]!.attempts).toHaveLength(1) // history kept
  })
  it("a running or fully completed run is not resumed", async () => {
    useRunsStore.setState({ runs: [{ ...run(), status: "running" }] } as never)
    expect(await useRunsStore.getState().resume("run_r")).toBe(false)
    useRunsStore.setState({ runs: [{ ...run(), plan: run().plan.map((s) => ({ ...s, state: "completed" })) }] } as never)
    expect(await useRunsStore.getState().resume("run_r")).toBe(false)
  })
  it("resumeBox finishes the box's run and walks on to the boxes behind it — without re-running the box", async () => {
    expect(await useBlueprintsStore.getState().resumeBox("b1", "main")).toBe(true)
    const st = useBlueprintsStore.getState()
    expect(st.byId("b1")!.nodes.find((n) => n.id === "main")!.status).toBe("done")
    expect(st.byId("b1")!.nodes.find((n) => n.id === "next")!.status).toBe("done")
    expect(singleCalls).toHaveLength(1) // only `next`
    expect(st.running).toEqual({})
  })
})

describe("Devret: hand one task to another model (2026-10-05)", () => {
  beforeEach(() => {
    resumed = undefined
    singleCalls.length = 0
    useBlueprintsStore.setState({ logs: {}, blueprints: [bp()], running: {} })
  })
  it("a running run hands the task over live", async () => {
    const calls: unknown[][] = []
    useRunsStore.setState({ runs: [{ ...run(), status: "running" }], executors: {}, handover: (...a: unknown[]) => { calls.push(a); return true } } as never)
    expect(await useBlueprintsStore.getState().handoverTask("b1", "main", "b", "claude:sonnet")).toBe(true)
    expect(calls).toEqual([["run_r", "b", "claude:sonnet"]])
  })
  it("a stopped run resumes with that task re-routed to the chosen model", async () => {
    const seen: Array<Record<string, string> | undefined> = []
    useRunsStore.setState({
      runs: [run()],
      executors: {},
      resume: async (_id: string, overrides?: Record<string, string>) => {
        seen.push(overrides)
        useRunsStore.setState({ runs: [{ ...run(), status: "running" }] } as never)
        setTimeout(() => useRunsStore.setState({ runs: [{ ...run(), status: "completed", plan: run().plan.map((x) => ({ ...x, state: "completed" })) }] } as never), 20)
        return true
      },
    } as never)
    expect(await useBlueprintsStore.getState().handoverTask("b1", "main", "b", "claude:sonnet")).toBe(true)
    expect(seen).toEqual([{ b: "claude:sonnet" }])
    expect(useBlueprintsStore.getState().byId("b1")!.nodes.find((n) => n.id === "main")!.status).toBe("done")
  })
  it("a finished task cannot be handed over", async () => {
    useRunsStore.setState({ runs: [{ ...run(), status: "running" }], executors: {} } as never)
    expect(await useBlueprintsStore.getState().handoverTask("b1", "main", "a", "claude:sonnet")).toBe(false)
  })
})

describe("accidental re-runs (2026-10-05)", () => {
  beforeEach(() => {
    useBlueprintsStore.setState({ logs: {}, blueprints: [bp()], running: {} })
  })
  it("resumableRun finds the box's unfinished run by folder when the link was lost", () => {
    const g = bp()
    g.nodes = g.nodes.map((n) => (n.id === "main" ? { ...n, executionId: undefined } : n))
    g.nodes.push({ id: "build", type: "build", x: 0, y: 0, data: { type: "build", title: "x", folderPath: "/tmp/mario", kind: "code" } })
    g.edges.push({ id: "e9", from: "main", to: "build" })
    useBlueprintsStore.setState({ blueprints: [g] })
    useRunsStore.setState({ runs: [{ ...run(), repoPath: "/tmp/mario", createdAt: Date.now() - 3600_000 }] } as never)
    expect(useBlueprintsStore.getState().resumableRun("b1", "main")?.id).toBe("run_r")
    useRunsStore.setState({ runs: [{ ...run(), repoPath: "/tmp/other", createdAt: Date.now() }] } as never)
    expect(useBlueprintsStore.getState().resumableRun("b1", "main")).toBeUndefined()
  })
  it("a finished or running run is not resumable", () => {
    useRunsStore.setState({ runs: [{ ...run(), status: "running" }] } as never)
    expect(useBlueprintsStore.getState().resumableRun("b1", "main")).toBeUndefined()
    useRunsStore.setState({ runs: [{ ...run(), plan: run().plan.map((x) => ({ ...x, state: "completed" })) }] } as never)
    expect(useBlueprintsStore.getState().resumableRun("b1", "main")).toBeUndefined()
  })
})
