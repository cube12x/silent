import type { SubtaskKind, WorkerState } from "@/domain"
import type { Worker, WorkerHandle, WorkerJob, WorkerSink } from "./Worker"
import { MODEL_BY_ID } from "../capabilities"

export interface SimulatedWorkerOptions {
  /** Multiplier on all delays; tests use 0. */
  speed?: number
  /** Deterministic pseudo-random seed. */
  seed?: number
  /** Probability [0,1] that an attempt fails (retryable). Default 0.12. */
  failureRate?: number
  /** Force outcomes per subtask kind for demos/tests: e.g. { tests: ["fail", "ok"] }. */
  script?: Partial<Record<SubtaskKind, Array<"ok" | "fail" | "block">>>
}

type Step = { state: WorkerState; progress: number; logs: string[]; commands?: string[]; files?: string[] }

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SCRIPTS: Record<SubtaskKind, (topic: string, repo: string) => Step[]> = {
  architecture: (t, r) => [
    { state: "planning", progress: 10, logs: [`Scanning ${r} …`, "Reading package manifest, entrypoints, module graph"], commands: [`rg --files ${r} | head -200`, `cat ${r}/package.json`] },
    { state: "thinking", progress: 45, logs: ["Identifying boundaries: transport / domain / ui", `Drafting decomposition for "${t}"`] },
    { state: "coding", progress: 80, logs: ["Writing docs/ARCHITECTURE-BRIEF.md", "Emitting contracts for downstream workers"], files: ["docs/ARCHITECTURE-BRIEF.md"] },
    { state: "reviewing", progress: 95, logs: ["Self-check: no circular deps, contracts typed"] },
  ],
  backend: (t, r) => [
    { state: "thinking", progress: 10, logs: ["Reading architecture brief", "Locating service layer"] },
    { state: "coding", progress: 40, logs: [`Implementing ${t} service`, "Adding data model + migration"], files: [`${r}/src/server/${slug(t)}.ts`, `${r}/migrations/0007_${slug(t)}.sql`], commands: ["npm run typecheck"] },
    { state: "coding", progress: 70, logs: ["Wiring route handlers", "Adding input validation"], files: [`${r}/src/server/routes/${slug(t)}.ts`] },
    { state: "testing", progress: 90, logs: ["Running unit tests for service"], commands: ["npx vitest run src/server"] },
  ],
  frontend: (t, r) => [
    { state: "thinking", progress: 10, logs: ["Reading backend contract", "Checking design system tokens"] },
    { state: "coding", progress: 45, logs: [`Building ${t} components`, "Adding store slice"], files: [`${r}/src/features/${slug(t)}/index.tsx`, `${r}/src/stores/${slug(t)}.ts`] },
    { state: "coding", progress: 75, logs: ["Hooking up live updates", "Empty/error states"], commands: ["npm run lint"] },
    { state: "reviewing", progress: 92, logs: ["Visual pass at 1440p / 4K"] },
  ],
  algorithm: (t, r) => [
    { state: "thinking", progress: 15, logs: ["Formalising problem", "Complexity target: O(n log n)"] },
    { state: "coding", progress: 50, logs: ["Implementing core routine", "Adding property-based tests"], files: [`${r}/src/core/${slug(t)}.ts`] },
    { state: "testing", progress: 80, logs: ["Benchmark: 1e6 items in 41 ms"], commands: ["npx vitest bench src/core"] },
    { state: "reviewing", progress: 95, logs: ["Edge cases: empty input, duplicates, overflow"] },
  ],
  tests: (t, r) => [
    { state: "thinking", progress: 10, logs: ["Mapping behaviour to test cases"] },
    { state: "coding", progress: 50, logs: ["Writing unit + integration specs"], files: [`${r}/src/__tests__/${slug(t)}.test.ts`] },
    { state: "testing", progress: 85, logs: ["Running full suite", "42 passed, 0 failed"], commands: ["npm test -- --run"] },
  ],
  review: (t) => [
    { state: "reviewing", progress: 20, logs: ["Reading full diff", `Checking ${t} against guardrails`], commands: ["git diff --stat"] },
    { state: "reviewing", progress: 60, logs: ["Security pass: input validation ok, no secrets", "Perf pass: no N+1"] },
    { state: "reviewing", progress: 90, logs: ["2 nits, 0 blockers — writing review summary"] },
  ],
  integration: (_t, r) => [
    { state: "thinking", progress: 10, logs: ["Collecting upstream outputs"] },
    { state: "coding", progress: 50, logs: ["Wiring frontend ↔ backend", "Resolving import paths"], files: [`${r}/src/app/routes.tsx`], commands: ["npm run typecheck"] },
    { state: "testing", progress: 85, logs: ["End-to-end smoke: feature reachable"], commands: ["npm run test:e2e -- --grep smoke"] },
  ],
  docs: (t, r) => [
    { state: "coding", progress: 40, logs: [`Documenting ${t}`], files: [`${r}/README.md`, `${r}/CHANGELOG.md`] },
    { state: "reviewing", progress: 90, logs: ["Checking links and code samples"] },
  ],
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "feature"
}

/**
 * Produces a believable, deterministic execution timeline for models Silent cannot execute for real yet.
 * Emits exactly the same sink calls as a real worker, so the UI is provider-agnostic.
 */
export class SimulatedWorker implements Worker {
  readonly id = "simulated"
  private rand: () => number
  private speed: number
  private failureRate: number
  private script: NonNullable<SimulatedWorkerOptions["script"]>
  private scriptCursor = new Map<SubtaskKind, number>()

  constructor(opts: SimulatedWorkerOptions = {}) {
    this.rand = mulberry32(opts.seed ?? 1337)
    this.speed = opts.speed ?? 1
    this.failureRate = opts.failureRate ?? 0.12
    this.script = opts.script ?? {}
  }

  supports(): boolean {
    return true
  }

  start(job: WorkerJob, sink: WorkerSink): WorkerHandle {
    let cancelled = false
    const pending = new Set<{ timer: ReturnType<typeof setTimeout>; resolve: () => void }>()
    const model = MODEL_BY_ID[job.modelId]
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        if (this.speed === 0 || cancelled) return resolve()
        const entry = { timer: setTimeout(() => { pending.delete(entry); resolve() }, ms * this.speed), resolve }
        pending.add(entry)
      })

    const done = (async () => {
      const topic = job.subtask.title.split(":").slice(1).join(":").trim() || job.subtask.kind
      const repo = job.repoPath ? job.repoPath.split("/").filter(Boolean).pop() ?? "repo" : "workspace"
      const steps = SCRIPTS[job.subtask.kind](topic, repo)
      const outcome = this.decide(job.subtask.kind)

      sink.log(`[${model?.displayName ?? job.modelId}] attempt ${job.attempt} · ${job.subtask.kind}`, "system")
      sink.log(`brief: ${job.brief.split("\n")[0]}`, "system")
      const failAt = outcome === "ok" ? -1 : Math.max(1, Math.floor(steps.length * (0.4 + this.rand() * 0.4)))

      for (let i = 0; i < steps.length; i++) {
        if (cancelled) return { ok: false, summary: "cancelled", error: "cancelled", retryable: false }
        const step = steps[i]
        sink.state(step.state, step.progress)
        for (const c of step.commands ?? []) {
          sink.command(c)
          sink.log(`$ ${c}`)
          await wait(250 + this.rand() * 400)
        }
        for (const f of step.files ?? []) sink.file(f)
        for (const line of step.logs) {
          sink.log(line)
          await wait(350 + this.rand() * 900 * (job.subtask.weight / 2))
        }
        if (i === failAt) {
          if (outcome === "block") {
            sink.state("blocked", step.progress)
            sink.log("Blocked: needs a decision on data retention policy", "stderr")
            await wait(600)
            return { ok: false, summary: "Blocked on missing decision", error: "blocked: policy decision required", retryable: true }
          }
          const err = this.failureMessage(job.subtask.kind)
          sink.log(err, "stderr")
          await wait(400)
          return { ok: false, summary: "Attempt failed", error: err, retryable: true }
        }
      }
      const tokens = Math.round((1800 + this.rand() * 4200) * job.subtask.weight)
      const costUsd = model ? (tokens / 1000) * ((model.costPer1kIn + model.costPer1kOut) / 2) : 0
      sink.usage(tokens, costUsd)
      sink.state("completed", 100)
      return { ok: true, summary: this.summary(job.subtask.kind, topic) }
    })()

    return {
      done,
      cancel: () => {
        cancelled = true
        for (const p of pending) {
          clearTimeout(p.timer)
          p.resolve()
        }
        pending.clear()
      },
    }
  }

  private decide(kind: SubtaskKind): "ok" | "fail" | "block" {
    const scripted = this.script[kind]
    if (scripted && scripted.length) {
      const i = this.scriptCursor.get(kind) ?? 0
      this.scriptCursor.set(kind, i + 1)
      return scripted[Math.min(i, scripted.length - 1)]
    }
    return this.rand() < this.failureRate ? "fail" : "ok"
  }

  private failureMessage(kind: SubtaskKind): string {
    const msgs: Record<SubtaskKind, string> = {
      architecture: "error: conflicting module ownership detected; brief rejected by self-check",
      backend: "error: TS2322 in src/server/service.ts — type mismatch on repository contract",
      frontend: "error: lint failed — react-hooks/exhaustive-deps (2)",
      algorithm: "error: property test failed: ordering not stable for equal keys",
      tests: "error: 3 tests failed (timeout waiting for socket)",
      review: "error: review found a blocker — unvalidated input reaches DB layer",
      integration: "error: e2e smoke failed — route not registered",
      docs: "error: broken relative link in README",
    }
    return msgs[kind]
  }

  private summary(kind: SubtaskKind, topic: string): string {
    const s: Record<SubtaskKind, string> = {
      architecture: `Decomposed "${topic}" into transport, domain and UI slices; contracts published to downstream workers.`,
      backend: `Implemented ${topic} service, data model and route handlers; unit tests green.`,
      frontend: `Built ${topic} UI with live updates and empty/error states; lint clean.`,
      algorithm: `Core routine for ${topic} at O(n log n) with property tests and benchmark.`,
      tests: `Added unit and integration coverage for ${topic}; suite passes.`,
      review: `Reviewed ${topic}: no blockers, 2 nits fixed inline.`,
      integration: `Wired ${topic} end-to-end; smoke test passes.`,
      docs: `Documented ${topic} in README and changelog.`,
    }
    return s[kind]
  }
}
