import type { SilentCodeRun, Subtask, TerminalLine } from "@/domain"
import { planSubtasks } from "@/engine/planner"
import { routeSubtasks } from "@/engine/router"
import { estimateRun } from "@/engine/estimate"
import { MODELS } from "@/engine/capabilities"

const H = 3600_000
const now = Date.now()
const ALL = MODELS.map((m) => m.id)

function build(id: string, title: string, prompt: string, opts: Partial<SilentCodeRun> & { pool?: string[] }): { run: SilentCodeRun; lines: Record<string, TerminalLine[]> } {
  const pool = opts.pool ?? ALL
  const plan = planSubtasks({ prompt, repoPath: opts.repoPath }, id)
  const routing = routeSubtasks({ subtasks: plan, pool, costMode: opts.costMode ?? "balanced" })
  const mode = opts.executionMode ?? "staged"
  const run: SilentCodeRun = {
    id,
    title,
    prompt,
    modelPool: pool,
    executionMode: mode,
    costMode: opts.costMode ?? "balanced",
    plan,
    routing,
    status: opts.status ?? "planned",
    estimate: estimateRun(plan, routing, mode),
    createdAt: opts.createdAt ?? now - 3 * H,
    startedAt: opts.startedAt,
    finishedAt: opts.finishedAt,
    repoAgentId: opts.repoAgentId,
    repoPath: opts.repoPath,
    actual: opts.actual,
  }
  return { run, lines: {} }
}

function finish(s: Subtask, modelId: string, files: string[], commands: string[], summary: string, at: number): Subtask {
  return {
    ...s,
    state: "completed",
    progress: 100,
    assignedModelId: modelId,
    attempts: [{ n: 1, modelId, startedAt: at - 200_000, finishedAt: at, outcome: "success", cause: "initial" }],
    files,
    commands,
    summary,
    lastUpdate: at,
  }
}

// --- Completed run: notifications on Reach --------------------------------------------------
const notify = build("run_notify", "Real-time notification system", "Add a real-time notification system to the Reach repository with websocket fan-out, an API endpoint and tests.", {
  repoAgentId: "agent_reach",
  repoPath: "/Users/cube/CubeCode/reach",
  status: "completed",
  createdAt: now - 2.6 * H,
  startedAt: now - 2.5 * H,
  finishedAt: now - 2 * H,
  actual: { tokens: 61_200, costUsd: 1.84 },
})
notify.run.plan = notify.run.plan.map((s, i) => {
  const r = notify.run.routing.find((x) => x.subtaskId === s.id)!
  const at = now - 2.5 * H + (i + 1) * 4 * 60_000
  const files: Record<string, string[]> = {
    architecture: ["docs/ARCHITECTURE-BRIEF.md"],
    backend: ["src/server/notify/hub.ts", "src/server/notify/service.ts", "migrations/0007_notifications.sql"],
    frontend: ["src/features/notifications/Bell.tsx", "src/stores/notifications.ts"],
    integration: ["src/app/routes.tsx", "src/server/routes/ws.ts"],
    tests: ["src/server/notify/hub.test.ts", "src/features/notifications/Bell.test.tsx"],
    review: [],
    docs: ["README.md", "CHANGELOG.md"],
    algorithm: [],
  }
  const cmds: Record<string, string[]> = {
    architecture: ["rg --files reach | head -200"],
    backend: ["npm run typecheck", "npx vitest run src/server/notify"],
    frontend: ["npm run lint"],
    integration: ["npm run typecheck", "npm run test:e2e -- --grep smoke"],
    tests: ["npm test -- --run"],
    review: ["git diff --stat"],
    docs: [],
    algorithm: [],
  }
  const summaries: Record<string, string> = {
    architecture: "Split into hub (fan-out), service (persistence) and client bell; contracts published.",
    backend: "NotificationHub with per-connection backpressure; service persists via Drizzle.",
    frontend: "Bell component with live badge; store slice with optimistic read state.",
    integration: "WS route registered; feature reachable end-to-end.",
    tests: "16 tests incl. reconnect backoff; suite green.",
    review: "No blockers. Asked for zod schema on the mark-read handler; applied.",
    docs: "README section + changelog entry.",
    algorithm: "",
  }
  return finish(s, r.primaryModelId, files[s.kind], cmds[s.kind], summaries[s.kind], at)
})

// --- Running run: diffusion on Cube Risk ------------------------------------------------------
const diffusion = build("run_diffusion", "Vectorise diffusion step", "Optimise the diffusion step algorithm in the simulation engine for performance, add benchmarks and tests.", {
  repoAgentId: "agent_cube_risk",
  repoPath: "/Users/cube/CubeCode/cube-risk-world-simulation-engine",
  status: "running",
  createdAt: now - 0.4 * H,
  startedAt: now - 0.3 * H,
  costMode: "max-quality",
})
diffusion.run.plan = diffusion.run.plan.map((s, i) => {
  const r = diffusion.run.routing.find((x) => x.subtaskId === s.id)!
  const t0 = now - 0.3 * H
  if (s.kind === "architecture") return finish(s, r.primaryModelId, ["docs/ARCHITECTURE-BRIEF.md"], ["rg --files | head"], "Hot path isolated to diffuse(); typed-array plan agreed.", t0 + 5 * 60_000)
  if (s.kind === "algorithm")
    return { ...s, state: "coding", progress: 62, assignedModelId: r.primaryModelId, attempts: [{ n: 1, modelId: r.primaryModelId, startedAt: t0 + 5 * 60_000, outcome: "running", cause: "initial" }], files: ["src/core/diffuse.ts"], commands: ["npx vitest bench src/core"], lastUpdate: now - 40_000 }
  if (s.kind === "tests")
    return { ...s, state: "waiting", progress: 0, assignedModelId: r.primaryModelId, attempts: [], lastUpdate: t0 + i * 1000 }
  return { ...s, state: "waiting", progress: 0, lastUpdate: t0 + i * 1000 }
})

// --- Failed-then-recovered run --------------------------------------------------------------------
const nan = build("run_nan", "Fix NaN in pressure solver", "Fix the NaN produced by the pressure solver algorithm under zero-volume cells and add regression tests.", {
  repoAgentId: "agent_cube_risk",
  repoPath: "/Users/cube/CubeCode/cube-risk-world-simulation-engine",
  status: "completed",
  createdAt: now - 21 * H,
  startedAt: now - 20.8 * H,
  finishedAt: now - 20 * H,
  actual: { tokens: 44_900, costUsd: 2.31 },
})
nan.run.plan = nan.run.plan.map((s, i) => {
  const r = nan.run.routing.find((x) => x.subtaskId === s.id)!
  const at = now - 20.8 * H + (i + 1) * 6 * 60_000
  if (s.kind === "tests") {
    return {
      ...finish(s, "claude-opus", ["src/core/pressure.test.ts"], ["npm test -- --run"], "Regression test for zero-volume cells; suite green on Opus after Gemini timed out twice.", at),
      attempts: [
        { n: 1, modelId: "gemini", startedAt: at - 700_000, finishedAt: at - 520_000, outcome: "failure", cause: "initial", error: "error: 3 tests failed (timeout waiting for socket)" },
        { n: 2, modelId: "gemini", startedAt: at - 500_000, finishedAt: at - 380_000, outcome: "failure", cause: "retry", error: "error: 3 tests failed (timeout waiting for socket)" },
        { n: 3, modelId: "claude-opus", startedAt: at - 360_000, finishedAt: at, outcome: "success", cause: "fallback" },
      ],
    }
  }
  return finish(s, r.primaryModelId, [], [], `${s.kind} completed.`, at)
})

export const MOCK_RUNS: SilentCodeRun[] = [diffusion.run, notify.run, nan.run]

/** Terminal lines for the running algorithm subtask so the drawer has something live-looking. */
export function mockTerminalLines(run: SilentCodeRun): Record<string, TerminalLine[]> {
  const out: Record<string, TerminalLine[]> = {}
  for (const s of run.plan) {
    const lines: TerminalLine[] = []
    const base = s.attempts[0]?.startedAt ?? run.startedAt ?? run.createdAt
    lines.push({ ts: base, stream: "system", text: `[${s.assignedModelId ?? "unassigned"}] ${s.kind} · attempt ${s.attempts.length || 1}` })
    for (const c of s.commands) lines.push({ ts: base + 1000, stream: "stdout", text: `$ ${c}` })
    for (const f of s.files) lines.push({ ts: base + 2000, stream: "stdout", text: `write ${f}` })
    for (const a of s.attempts) if (a.error) lines.push({ ts: a.finishedAt ?? base, stream: "stderr", text: a.error })
    if (s.summary) lines.push({ ts: s.lastUpdate, stream: "system", text: s.summary })
    out[s.id] = lines
  }
  return out
}
