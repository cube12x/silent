import type { CliRunRequest, ModelTier, ProviderModel, RuntimeEvent, Subtask, SubtaskKind } from "@/domain"
import { modelRef } from "@/domain"
import { providerInfo } from "@/providers/registry"
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
  /** Expert kit brief (English) — the planner must plan to its quality bar. */
  kitBrief?: string
}

export interface PlannerRunner {
  cliStart(request: CliRunRequest, onEvent: (event: RuntimeEvent) => void): Promise<{ cancel(): Promise<void> }>
}

export const PLANNER_TIMEOUT_SECS = 240

/** Pick the planner model: a strong-tier model from the pool, else the best available. */
export function pickPlannerModel(models: ProviderModel[]): ProviderModel | undefined {
  const order = (m: ProviderModel) => (m.tier === "strong" ? 0 : m.tier === "frontier" ? 1 : 2)
  // Only CLIs whose structured planning is verified (Antigravity rejected the schema with INVALID_ARGUMENT, 2026-09-25).
  const capable = models.filter((m) => providerInfo(m.providerId).capabilities.planner)
  return [...capable].sort((a, b) => order(a) - order(b) || (a.isDefault ? -1 : 1))[0]
}

/** Short, model-family based strengths so the planner can assign tasks sensibly (kept generic and honest). */
export function modelStrengths(m: ProviderModel): string {
  const id = m.id.toLowerCase()
  const p = m.providerId
  if (p === "claude") {
    if (/fable|opus/.test(id)) return "deepest reasoning; architecture, contracts, long coherent systems, reviews; can drive a browser"
    if (/sonnet/.test(id)) return "strong all-round implementation and integration; can drive a browser"
    if (/haiku/.test(id)) return "fast and cheap; tests, docs, small mechanical edits; can drive a browser"
    return "Claude model; can drive a browser"
  }
  if (p === "codex") {
    if (/astra/.test(id)) return "frontier; creative gameplay, visuals, effects, content and algorithms; sandboxed (no browser)"
    if (/sol|luna/.test(id)) return "frontier; strong implementation and refactors; sandboxed (no browser)"
    if (/terra/.test(id)) return "strong and cheaper; solid implementation; sandboxed (no browser)"
    if (/mini|fast/.test(id)) return "fast and cheap; mechanical work; sandboxed (no browser)"
    return "OpenAI model; sandboxed (no browser)"
  }
  if (p === "grok") return /fast/.test(id) ? "fast iteration, cheap; implementation and tuning; can run a browser" : "frontier; creative content and effects; can run a browser"
  if (p === "antigravity") return /pro|opus/.test(id) ? "frontier Google/partner model; design and reviews; can run a browser" : "fast Google model; implementation, tests, docs; can run a browser"
  return `${m.tier} model`
}

export function buildPlannerPrompt(ctx: AiPlanContext): string {
  const tiers = Array.from(new Set(ctx.models.map((m) => m.tier))).sort((a, b) => TIER_RANK[a] - TIER_RANK[b])
  const lines = [
    "You are Silent's planner. Turn the user's request into the SMALLEST set of subtasks that real coding CLIs will execute one by one in this repository.",
    "- First write `spec` IN ENGLISH: a precise product spec the workers build against — goal, the user's explicit wishes verbatim (translated), success criteria, quality bar (production-grade, polished, complete — never a demo or scaffold), non-goals. Workers never see the raw request, only this spec: be complete.",
    "- Write every subtask `description` IN ENGLISH (it is the worker's instruction): what to build, the exact acceptance criteria, what to verify and how. Write `title`, `summary`, `questions` and `assumptions` in the user's language.",
    ...(ctx.kitBrief ? [`- An expert kit applies. Plan to its quality bar and checklist; tell workers to study the references first. The reference repositories ARE cloned into <repo>/.silent/refs/<name> by Silent before any worker starts (never ask about it):\n${ctx.kitBrief}`] : []),
    "Rules:",
    "- Produce ONLY subtasks that are genuinely needed for this request. Never add an 'algorithm', 'docs' or any other subtask just because it is common. If the user excluded something, do not include it and list it under `excluded`.",
    "- Size every subtask so ONE CLI session finishes it in at most ~25 minutes of work (weight 3 = the upper bound; a task that needs more is two tasks). Do not merge unrelated systems into one task (e.g. combat core, enemies+bosses and player controller are three tasks that run in parallel). Typical plan: 4–7 tasks, 9 maximum. Each CLI run costs minutes of startup, so do not split one coherent small piece either.",
    "- Set `dependsOn` ONLY when a task truly needs another task's output. Independent tasks run IN PARALLEL on different models — a long serial chain is the slowest possible plan. Typical fast shape: one architecture task (only if needed) → several independent build tasks split by area (they run at the same time) → tests and review that depend only on the build tasks (they run at the same time too).",
    "- Set `needsBrowser: true` ONLY for a task that must launch a real browser (Playwright/E2E/visual QA). Such tasks are routed to a CLI that can launch one; all other tasks get `needsBrowser: false`. Local dev servers, curl and headless Node checks do NOT need it.",
    "- The FIRST task (architecture/foundation) owns EVERY root file (package.json, lockfile, tsconfig, vite/vitest/eslint configs, .gitignore, README.md, index.html) plus src/main.ts as a minimal bootable entry and docs/ARCHITECTURE-BRIEF.md, so `install`, `typecheck`, `test` and `build` are green before any parallel task starts. Its brief must use the SAME paths this plan assigns (write the ownership map into the brief).",
    "- Only tasks with `needsBrowser: true` may be asked to verify in a real browser; every other task verifies with unit tests, typecheck and headless checks of its own paths, and must not be asked for browser or playtest checks.",
    "- Exactly one integration task (last, depends on all build tasks) owns cross-module wiring, the full test suite and fixing mismatches between modules; build tasks are told that sibling modules are in progress at the same time.",
    "- Parallel tasks share one repository: give every task an explicit OWNERSHIP line in its description (`Owns: src/game/player/**, src/game/input.ts`) and make the owned paths DISJOINT across tasks that can run at the same time. Shared contracts/types belong to the architecture task (or to exactly one task); other tasks may only add to them.",
    "- docs/ARCHITECTURE-BRIEF.md must stay under 12 KB with the normative sections (module map, contracts, conventions, ownership) first; every worker reads it, so long prose costs tokens on every task.",
    "- If an architecture task exists, its description must say to write docs/ARCHITECTURE-BRIEF.md (module map, contracts, conventions): every later worker receives that file and skips repository discovery.",
    "- Kinds: architecture (only for larger multi-part work), backend, frontend, algorithm, tests, review, integration, docs.",
    "- Each subtask: a concrete title, a precise description another engineer could execute, dependencies by key, weight 1-3, the model tier it deserves (fast for light/mechanical work, strong for normal implementation, frontier only for hard design/algorithms/critical review), and effort.",
    `- MODELS IN THE POOL (choose \`model\` per task from these exact refs; "" lets the router pick by tier):\n${ctx.models.map((m) => `  ${modelRef(m.providerId, m.id)} — ${m.tier} — ${modelStrengths(m)}`).join("\n")}`,
    "- Match each task to the model that is genuinely best at it (architecture and cross-module contracts → the deepest reasoning model; creative visuals, effects, game feel and content → a creative frontier model; solid implementation → strong models; tests/docs → fast models). Prefer a cheaper model when the task is mechanical. Browser-driving tasks must use a Claude model (Codex/Grok sandboxes cannot launch a browser).",
    `- Available tiers in the user's pool: ${tiers.join(", ") || "strong"}. Default policy kind→tier: ${Object.entries(ctx.policy).map(([k, v]) => `${k}=${v}`).join(", ")}. Follow it unless the task clearly needs otherwise; explain in rationale.`,
    "- If anything is ambiguous, or the request asks for something you cannot or should not do (legal, access, missing info), DO NOT decide silently: put it in `questions` (with why, and options when useful). Do not turn such things into `assumptions`.",
    "- `assumptions` only for harmless defaults. Keep `summary` to two sentences.",
    `- Language: \`title\`, \`summary\`, \`questions\`, \`assumptions\`, \`excluded\` in ${ctx.language === "tr" ? "Turkish" : "English"}; \`spec\` and every \`description\` ALWAYS in English.`,
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
    modelHint: s.model || undefined,
    effort: s.effort,
    rationale: s.rationale,
    needsBrowser: s.needsBrowser || undefined,
    answers: [],
    deviations: [],
  }))
}

export function poolLabel(models: ProviderModel[]): string {
  return models.map((m) => `${modelRef(m.providerId, m.id)} (${m.tier})`).join(", ")
}
