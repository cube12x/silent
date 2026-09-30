import type { Effort, ModelTier, SubtaskKind } from "@/domain"
import { SUBTASK_KINDS } from "@/domain"

/** What the AI planner must return. Mirrored as a JSON Schema for Codex `--output-schema` / Claude `--json-schema`. */
export interface AiPlanSubtask {
  key: string
  kind: SubtaskKind
  title: string
  description: string
  dependsOn: string[]
  weight: 1 | 2 | 3
  tier: ModelTier
  effort: Effort
  rationale: string
  /** Must drive a real browser (Playwright, visual QA): routed to a CLI whose sandbox can launch one. */
  needsBrowser: boolean
  /** Planner's model choice for this task: a `provider:model` ref from the offered pool, or "" to let the router decide. */
  model: string
  /** One shell line that verifies THIS task's own paths (owned test dirs + typecheck); "" = derive from the ownership line. */
  verify: string
}

export interface AiPlanQuestion {
  id: string
  question: string
  why: string
  options?: string[]
}

export interface AiPlan {
  /** English product spec: goal, success criteria, quality bar, non-goals. */
  spec: string
  summary: string
  subtasks: AiPlanSubtask[]
  questions: AiPlanQuestion[]
  assumptions: string[]
  excluded: string[]
}

export const AI_PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "spec", "subtasks", "questions", "assumptions", "excluded"],
  properties: {
    spec: { type: "string" },
    summary: { type: "string" },
    subtasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "kind", "title", "description", "dependsOn", "weight", "tier", "effort", "rationale", "needsBrowser", "model", "verify"],
        properties: {
          key: { type: "string" },
          kind: { type: "string", enum: [...SUBTASK_KINDS] },
          title: { type: "string" },
          description: { type: "string" },
          dependsOn: { type: "array", items: { type: "string" } },
          weight: { type: "integer", minimum: 1, maximum: 3 },
          tier: { type: "string", enum: ["fast", "strong", "frontier"] },
          effort: { type: "string", enum: ["low", "medium", "high", "xhigh"] },
          rationale: { type: "string" },
          needsBrowser: { type: "boolean" },
          model: { type: "string" },
          verify: { type: "string" },
        },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question", "why", "options"],
        properties: { id: { type: "string" }, question: { type: "string" }, why: { type: "string" }, options: { type: "array", items: { type: "string" } } },
      },
    },
    assumptions: { type: "array", items: { type: "string" } },
    excluded: { type: "array", items: { type: "string" } },
  },
}

/** Lenient parse: accepts the whole message, or the first {...} block inside prose. */
export function parseAiPlan(text: string): AiPlan | null {
  const candidates = [text.trim()]
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1))
  for (const c of candidates) {
    try {
      const v = JSON.parse(c) as Partial<AiPlan>
      if (!v || !Array.isArray(v.subtasks)) continue
      const subtasks = v.subtasks
        .filter((s) => s && typeof s.title === "string" && SUBTASK_KINDS.includes(s.kind as SubtaskKind))
        .map((s, i) => ({
          key: String(s.key ?? `t${i + 1}`),
          kind: s.kind as SubtaskKind,
          title: s.title!,
          description: String(s.description ?? ""),
          dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [],
          weight: (s.weight === 1 || s.weight === 3 ? s.weight : 2) as 1 | 2 | 3,
          tier: (["fast", "strong", "frontier"].includes(String(s.tier)) ? s.tier : "strong") as ModelTier,
          effort: (["low", "medium", "high", "xhigh"].includes(String(s.effort)) ? s.effort : "medium") as Effort,
          rationale: String(s.rationale ?? ""),
          needsBrowser: s.needsBrowser === true,
          model: typeof s.model === "string" ? s.model.trim() : "",
          verify: typeof s.verify === "string" ? s.verify.trim() : "",
        }))
      if (!subtasks.length) continue
      return {
        summary: String(v.summary ?? ""),
        spec: String(v.spec ?? ""),
        subtasks,
        questions: Array.isArray(v.questions) ? v.questions.filter((q) => q && typeof q.question === "string").map((q, i) => ({ id: String(q.id ?? `q${i + 1}`), question: q.question, why: String(q.why ?? ""), options: Array.isArray(q.options) ? q.options.map(String) : undefined })) : [],
        assumptions: Array.isArray(v.assumptions) ? v.assumptions.map(String) : [],
        excluded: Array.isArray(v.excluded) ? v.excluded.map(String) : [],
      }
    } catch {
      /* try next candidate */
    }
  }
  return null
}
