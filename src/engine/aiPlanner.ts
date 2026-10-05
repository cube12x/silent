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
  /** Turbo preset: lean plan, no review/docs, browser work capped (Faz 3). */
  turbo?: boolean
  /** Mechanical preset: cheapest pool model for tests/docs/translation (Faz 3). */
  mechanical?: boolean
  /** Lite / Bölücü (Faz 4): only disjoint build tasks; a separate Dikiş step stitches afterwards. */
  lite?: boolean
  /** Dosage sentence (engine/dosage.ts dosageLine): the user's quota plan per provider. */
  dosage?: string
}

export interface PlannerRunner {
  cliStart(request: CliRunRequest, onEvent: (event: RuntimeEvent) => void): Promise<{ cancel(): Promise<void> }>
}

export const PLANNER_TIMEOUT_SECS = 240

/** Pick the planner model: a strong-tier model from the pool, else the best available. */
export function pickPlannerModel(models: ProviderModel[], weights?: Partial<Record<ProviderModel["providerId"], number>>): ProviderModel | undefined {
  const order = (m: ProviderModel) => (m.tier === "strong" ? 0 : m.tier === "frontier" ? 1 : 2)
  const w = (m: ProviderModel) => (weights && weights[m.providerId] !== undefined ? weights[m.providerId]! : 1)
  // Only CLIs whose structured planning is verified (Antigravity rejected the schema with INVALID_ARGUMENT, 2026-09-25).
  const capable = models.filter((m) => providerInfo(m.providerId).capabilities.planner && w(m) > 0)
  // Dosage: a minimal provider plans only when nothing else can (planning is one short call, so low/medium are fine).
  return [...capable].sort((a, b) => Number(w(a) <= 0.15) - Number(w(b) <= 0.15) || order(a) - order(b) || (a.isDefault ? -1 : 1))[0]
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
  if (p === "grok")
    return /fast/.test(id)
      ? "fast iteration, cheap; implementation and tuning; can run a browser; can GENERATE RASTER IMAGES (image_gen / image_edit tools)"
      : "frontier; creative content and effects; can run a browser; can GENERATE RASTER IMAGES (image_gen / image_edit tools)"
  if (p === "antigravity")
    return /pro|opus/.test(id)
      ? "frontier Google/partner model; design and reviews; can run a browser; can GENERATE RASTER IMAGES (sprites, backgrounds, portraits, key art) with its built-in image tool — the only pool model that can draw"
      : "fast Google model; implementation, tests, docs; can run a browser; can GENERATE RASTER IMAGES with its built-in image tool"
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
    "- Artwork: when the request wants drawn/painted/pixel art assets, give the art tasks (sprites, backgrounds, portraits, key art as PNG files) to a model whose strengths say it can GENERATE RASTER IMAGES, and make the task description say to use the built-in image generation tool and save the PNGs under the project's assets folder. If no pool model can draw, art must be produced in code (vector/pixel drawing) and say so.",
    "- Set `needsBrowser: true` ONLY for a task that must launch a real browser (Playwright/E2E/visual QA). Such tasks are routed to a CLI that can launch one; all other tasks get `needsBrowser: false`. Local dev servers, curl and headless Node checks do NOT need it.",
    "- Browser verification is PARALLEL: plan one `needsBrowser: true` task PER act/area/screen group (weight 1, a fast browser-capable model), never one long play-through of everything; these tasks depend only on the integration task and run at the same time.",
    "- The FIRST task (architecture/foundation) owns EVERY root file (package.json, lockfile, tsconfig, vite/vitest/eslint configs, .gitignore, README.md, index.html) plus src/main.ts as a minimal bootable entry and docs/ARCHITECTURE-BRIEF.md, so `install`, `typecheck`, `test` and `build` are green before any parallel task starts. Its brief must use the SAME paths this plan assigns (write the ownership map into the brief).",
    "- Only tasks with `needsBrowser: true` may be asked to verify in a real browser; every other task verifies with unit tests, typecheck and headless checks of its own paths, and must not be asked for browser or playtest checks.",
    "- Every build task wires its own area into the app itself (registration, imports, level hooks) and leaves the suite green for its own paths; the final integration task (last, depends on all build tasks, weight 1 or 2) only runs the full suite, fixes cross-area seams and removes dead fallbacks — it must not be a second implementation pass.",
    "- Parallel tasks share one repository: give every task an explicit OWNERSHIP line in its description (`Owns: src/game/player/**, src/game/input.ts`) and make the owned paths DISJOINT across tasks that can run at the same time. Shared contracts/types belong to the architecture task (or to exactly one task); other tasks may only add to them.",
    "- docs/ARCHITECTURE-BRIEF.md must stay under 12 KB with the normative sections (module map, contracts, conventions, ownership) first; every worker reads it, so long prose costs tokens on every task.",
    "- If an architecture task exists, its description must say to write docs/ARCHITECTURE-BRIEF.md (module map, contracts, conventions): every later worker receives that file and skips repository discovery.",
    ...(ctx.turbo ? ["- TURBO MODE: the user wants the fastest possible run. Plan NO review or docs task and no separate tests task (each build task verifies its own paths); plan at most one `needsBrowser: true` task and limit it to the areas this request changes; keep every task at weight ≤ 2 and `effort` ≤ medium; skip anything that is not needed to finish the request."] : []),
    ...(ctx.lite ? ["- LITE MODE (Bölücü): plan ONLY disjoint build tasks, one per independent area of the request that the PROJECT CONTEXT/digest does not already show as implemented (re-running after a crash must plan only the missing areas) (each wires its own area into the app and keeps its own paths green); NO review, tests, docs or integration task unless the request explicitly asks for one — a separate Dikiş (stitch) step runs the full suite and closes the seams afterwards. Weight ≤ 2, effort ≤ medium, no architecture task unless the areas share a new contract."] : []),
    ...(ctx.mechanical ? ["- MECHANICAL MODE: route tests, docs, translation/localization, asset conversion and other mechanical work to the CHEAPEST/fastest model in the pool (its exact ref in `model`); keep architecture, cross-module contracts and integration on the deepest reasoning model."] : []),
    "- Kinds: architecture (only for larger multi-part work), backend, frontend, algorithm, tests, review, integration, docs.",
    "- Each subtask: a concrete title, a precise description another engineer could execute, dependencies by key, weight 1-3, the model tier it deserves (fast for light/mechanical work, strong for normal implementation, frontier only for hard design/algorithms/critical review), and effort.",
    "- `verify`: ONE shell line that checks only that task's own paths from the repository's test layout (e.g. `npx vitest run tests/player && npx tsc --noEmit`); the integration task's line runs the full suite. Workers run exactly this instead of the whole suite.",
    `- MODELS IN THE POOL (choose \`model\` per task from these exact refs; "" lets the router pick by tier):\n${ctx.models.map((m) => `  ${modelRef(m.providerId, m.id)} — ${m.tier} — ${modelStrengths(m)}`).join("\n")}`,
    ...(ctx.dosage ? [ctx.dosage] : []),
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

/** One CLI call: the last agent message (raw text) and the failure message, if the run failed before answering. */
async function askOnce(runner: PlannerRunner, prompt: string, ctx: AiPlanContext, model: ProviderModel, onLog?: (line: string) => void): Promise<{ raw: string; failed?: string }> {
  let raw = ""
  let failed: string | undefined
  await new Promise<void>((resolve) => {
    void runner
      .cliStart(
        {
          runId: `plan:${newId("p")}`,
          providerId: model.providerId,
          modelId: model.id,
          prompt,
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
  return { raw, failed }
}

/** What the planner sent back, trimmed for an error message. */
function replyHead(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim()
  return t ? `reply began: "${t.slice(0, 160)}${t.length > 160 ? "…" : ""}"` : "empty reply"
}

/**
 * Ask a real CLI for a structured plan. A reply that is not a JSON plan (prose, a question, a truncated object, an
 * empty message after a transient API hiccup) gets ONE repair round with the offending head quoted back; only then
 * does this throw, naming what came back so the failure is diagnosable. Callers fall back to the heuristic planner.
 */
export async function requestAiPlan(runner: PlannerRunner, ctx: AiPlanContext, model: ProviderModel, onLog?: (line: string) => void): Promise<AiPlanResult> {
  const prompt = buildPlannerPrompt(ctx)
  const first = await askOnce(runner, prompt, ctx, model, onLog)
  if (first.failed && !first.raw) throw new Error(first.failed)
  let plan = parseAiPlan(first.raw)
  let raw = first.raw
  if (!plan) {
    onLog?.(`planner reply was not a JSON plan (${replyHead(first.raw)}); asking once more`)
    const repair = `${prompt}\n\nYOUR PREVIOUS REPLY WAS NOT A VALID JSON PLAN (${replyHead(first.raw)}). Reply with ONLY the JSON object required by the schema: no prose, no code fence, no questions outside the \`questions\` field.`
    const second = await askOnce(runner, repair, ctx, model, onLog)
    if (second.failed && !second.raw) throw new Error(second.failed)
    plan = parseAiPlan(second.raw)
    raw = second.raw
    if (!plan) throw new Error(`planner returned no valid JSON after 2 attempts (${replyHead(second.raw)})`)
  }
  return { plan, model, raw }
}

/** Convert an AI plan into Subtasks (keys → ids, dependency wiring, hints preserved). */
export function subtasksFromAiPlan(plan: AiPlan, runId: string): Subtask[] {
  // One id per entry: a duplicated key (the planner repeats itself now and then) must not collapse two tasks into one;
  // dependencies on a duplicated key resolve to its first occurrence.
  const ids = plan.subtasks.map(() => newId("st"))
  const firstIdByKey = new Map<string, string>()
  plan.subtasks.forEach((s, i) => {
    if (!firstIdByKey.has(s.key)) firstIdByKey.set(s.key, ids[i]!)
  })
  const now = Date.now()
  return plan.subtasks.map((s, i) => ({
    id: ids[i]!,
    runId,
    kind: s.kind,
    title: s.title,
    description: s.description,
    dependsOn: Array.from(new Set(s.dependsOn.map((k) => firstIdByKey.get(k)).filter((x): x is string => Boolean(x) && x !== ids[i]))),
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
    verify: s.verify || undefined,
    answers: [],
    deviations: [],
  }))
}

export function poolLabel(models: ProviderModel[]): string {
  return models.map((m) => `${modelRef(m.providerId, m.id)} (${m.tier})`).join(", ")
}
