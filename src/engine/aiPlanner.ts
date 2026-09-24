import type { CliRunRequest, ModelTier, ProviderModel, RuntimeEvent, Subtask, SubtaskKind } from "@/domain"
import { modelRef } from "@/domain"
import { newId } from "@/lib/ids"
import { AI_PLAN_SCHEMA, parseAiPlan, type AiPlan } from "./planSchema"
import { TIER_RANK } from "./capabilities"

export interface AiPlanContext {
  prompt: string
  repoPath?: string
  repoSummary?: string
  architectureBrief?: string
  gatewayBrief?: string
  /** Models in the pool (for the planner to know which tiers exist). */
  models: ProviderModel[]
  /** kind → tier the router will use (auto table or the user's manual table). */
  policy: Record<SubtaskKind, ModelTier>
  /** Develop mode: summaries/deviations of the run being continued. */
  previous?: { title: string; summaries: string[]; deviations: string[] }
  answers?: Array<{ question: string; answer: string }>
  language: "tr" | "en"
}

export interface PlannerRunner {
  cliStart(request: CliRunRequest, onEvent: (event: RuntimeEvent) => void): Promise<{ cancel(): Promise<void> }>
}

export const PLANNER_TIMEOUT_SECS = 240

/** Pick the planner model: a strong-tier model from the pool, else the best available. */
export function pickPlannerModel(models: ProviderModel[]): ProviderModel | undefined {
  const order = (m: ProviderModel) => (m.tier === "strong" ? 0 : m.tier === "frontier" ? 1 : 2)
  return [...models].sort((a, b) => order(a) - order(b) || (a.isDefault ? -1 : 1))[0]
}

export function buildPlannerPrompt(ctx: AiPlanContext): string {
  const tiers = Array.from(new Set(ctx.models.map((m) => m.tier))).sort((a, b) => TIER_RANK[a] - TIER_RANK[b])
  const lines = [
    "You are Silent's planner. Turn the user's request into the SMALLEST set of subtasks that real coding CLIs will execute one by one in this repository.",
    "Rules:",
    "- Produce ONLY subtasks that are genuinely needed for this request. Never add an 'algorithm', 'docs' or any other subtask just because it is common. If the user excluded something, do not include it and list it under `excluded`.",
    "- Prefer FEW, LARGE subtasks (3–5 is typical, 7 is the maximum). Each CLI run costs minutes of startup and re-reading the repo, so do not split one coherent piece of work into several tasks.",
    "- Set `dependsOn` ONLY when a task truly needs another task's output. Independent tasks run IN PARALLEL on different models — a long serial chain is the slowest possible plan. Typical fast shape: one architecture task (only if needed) → several independent build tasks split by area (they run at the same time) → tests and review that depend only on the build tasks (they run at the same time too).",
    "- Parallel tasks share one repository: give every task an explicit OWNERSHIP line in its description (`Owns: src/game/player/**, src/game/input.ts`) and make the owned paths DISJOINT across tasks that can run at the same time. Shared contracts/types belong to the architecture task (or to exactly one task); other tasks may only add to them.",
    "- If an architecture task exists, its description must say to write docs/ARCHITECTURE-BRIEF.md (module map, contracts, conventions): every later worker receives that file and skips repository discovery.",
    "- Kinds: architecture (only for larger multi-part work), backend, frontend, algorithm, tests, review, integration, docs.",
    "- Each subtask: a concrete title, a precise description another engineer could execute, dependencies by key, weight 1-3, the model tier it deserves (fast for light/mechanical work, strong for normal implementation, frontier only for hard design/algorithms/critical review), and effort.",
    `- Available tiers in the user's pool: ${tiers.join(", ") || "strong"}. Default policy kind→tier: ${Object.entries(ctx.policy).map(([k, v]) => `${k}=${v}`).join(", ")}. Follow it unless the task clearly needs otherwise; explain in rationale.`,
    "- If anything is ambiguous, or the request asks for something you cannot or should not do (legal, access, missing info), DO NOT decide silently: put it in `questions` (with why, and options when useful). Do not turn such things into `assumptions`.",
    "- `assumptions` only for harmless defaults. Keep `summary` to two sentences.",
    `- Write titles/descriptions/questions in ${ctx.language === "tr" ? "Turkish" : "English"}.`,
    "- Answer ONLY with the JSON object required by the schema.",
    "",
    `USER REQUEST:\n${ctx.prompt}`,
  ]
  if (ctx.answers?.length) lines.push("", "ANSWERS TO YOUR EARLIER QUESTIONS:", ...ctx.answers.map((a) => `- Q: ${a.question}\n  A: ${a.answer}`))
  if (ctx.gatewayBrief) lines.push("", `AGENT PROFILE:\n${ctx.gatewayBrief}`)
  if (ctx.repoSummary) lines.push("", `REPOSITORY:\n${ctx.repoSummary}`)
  if (ctx.architectureBrief) lines.push("", `EXISTING ARCHITECTURE BRIEF (excerpt):\n${ctx.architectureBrief}`)
  if (ctx.previous) lines.push("", `THIS CONTINUES A PREVIOUS RUN "${ctx.previous.title}". The repository already exists; plan only incremental work.`, "Previous results:", ...ctx.previous.summaries.map((s) => `- ${s}`), ...(ctx.previous.deviations.length ? ["Previous deviations:", ...ctx.previous.deviations.map((d) => `- ${d}`)] : []))
  return lines.join("\n")
}

export interface AiPlanResult {
  plan: AiPlan
  model: ProviderModel
  raw: string
}

/** Ask a real CLI for a structured plan. Throws on failure; callers fall back to the heuristic planner. */
export async function requestAiPlan(runner: PlannerRunner, ctx: AiPlanContext, model: ProviderModel, onLog?: (line: string) => void): Promise<AiPlanResult> {
  let raw = ""
  let failed: string | undefined
  const done = new Promise<void>((resolve) => {
    void runner
      .cliStart(
        {
          runId: `plan:${newId("p")}`,
          providerId: model.providerId,
          modelId: model.id,
          prompt: buildPlannerPrompt(ctx),
          cwd: ctx.repoPath,
          sandbox: "read-only",
          ephemeral: true,
          effort: "medium",
          timeoutSecs: PLANNER_TIMEOUT_SECS,
          outputSchema: AI_PLAN_SCHEMA,
        },
        (e) => {
          if (e.type === "agentMessage") raw = e.data.text
          else if (e.type === "stderr") onLog?.(e.data.line)
          else if (e.type === "failed" && e.data.code !== "cancelled") failed = e.data.message
          else if (e.type === "exited") resolve()
        },
      )
      .catch((err: unknown) => {
        failed = err instanceof Error ? err.message : String(err)
        resolve()
      })
  })
  await done
  if (failed && !raw) throw new Error(failed)
  const plan = parseAiPlan(raw)
  if (!plan) throw new Error("planner returned no valid JSON")
  return { plan, model, raw }
}

/** Convert an AI plan into Subtasks (keys → ids, dependency wiring, hints preserved). */
export function subtasksFromAiPlan(plan: AiPlan, runId: string): Subtask[] {
  const ids = new Map(plan.subtasks.map((s) => [s.key, newId("st")]))
  const now = Date.now()
  return plan.subtasks.map((s, i) => ({
    id: ids.get(s.key)!,
    runId,
    kind: s.kind,
    title: s.title,
    description: s.description,
    dependsOn: s.dependsOn.map((k) => ids.get(k)).filter((x): x is string => Boolean(x) && x !== ids.get(s.key)),
    state: "waiting",
    attempts: [],
    files: [],
    commands: [],
    weight: s.weight,
    progress: 0,
    lastUpdate: now + i,
    tierHint: s.tier,
    effort: s.effort,
    rationale: s.rationale,
    answers: [],
    deviations: [],
  }))
}

export function poolLabel(models: ProviderModel[]): string {
  return models.map((m) => `${modelRef(m.providerId, m.id)} (${m.tier})`).join(", ")
}
