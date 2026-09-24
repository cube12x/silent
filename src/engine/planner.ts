import type { Subtask, SubtaskKind } from "@/domain"
import { newId } from "@/lib/ids"

export interface PlanInput {
  prompt: string
  repoPath?: string
  /** Kinds the Gateway profile wants emphasised. */
  focusKinds?: SubtaskKind[]
  /** Languages detected in the repo (from repo_inspect), influences titles only. */
  languages?: string[]
}

/** Words that mean a kind, in English and Turkish, used for both positive and negated mentions. */
const KIND_WORDS: Record<SubtaskKind, RegExp> = {
  architecture: /\b(architecture|mimari)\w*/i,
  backend: /\b(api|endpoint|server|database|db|schema|migration|service|queue|websocket|auth|backend|worker|cron|sunucu|veritaban\w*|servis)\b/i,
  frontend: /\b(ui|screen|page|component|frontend|dashboard|form|modal|button|react|layout|css|design|aray[üu]z|ekran|sayfa|bile[şs]en|tasar[ıi]m)\b/i,
  algorithm: /\b(algorithm\w*|algoritma\w*|optimi[sz]\w*|complexity|scheduler|ranking|search index|parser|compiler|encoding|compression)\b/i,
  tests: /\b(test\w*|coverage|spec|e2e|regression)\b/i,
  docs: /\b(doc|docs|documentation|readme|changelog|guide|dok[üu]man\w*|belge\w*)\b/i,
  integration: /\b(integrat\w*|wire|connect|hook up|glue|migrate|real-?time|notification|sync|pipeline|entegr\w*|ba[ğg]la\w*|bildirim)\b/i,
  review: /\b(review|inceleme|code review)\b/i,
}

/**
 * Negated mentions: "no tests", "without docs", "don't write an algorithm", "skip review",
 * "algoritma yazma", "test yazmayın", "dokümantasyon istemiyorum", "inceleme olmasın", "review gerek yok", "docs hariç".
 * Returns the kinds the user explicitly does not want.
 */
export function excludedKinds(prompt: string): Set<SubtaskKind> {
  const out = new Set<SubtaskKind>()
  const p = prompt.replace(/\s+/g, " ")
  for (const kind of Object.keys(KIND_WORDS) as SubtaskKind[]) {
    const word = KIND_WORDS[kind].source.replace(/^\\b\(|\)\\b$|\)\\w\*$/g, "")
    const en = new RegExp(`\\b(no|without|skip|avoid|don'?t|do not|never|not)\\s+(?:\\w+\\s+){0,2}?(?:${word})`, "i")
    const trAfter = new RegExp(`(?:${word})\\w*\\s+(?:\\w+\\s+){0,2}?(yazma\\b|yazmay[ıi]n|yapma\\b|yapmay[ıi]n|ekleme\\b|eklemeyin|istemiyorum|istemem|olmas[ıi]n|gerek yok|gereksiz|hari[çc]|yok\\b|koyma\\b|koymay[ıi]n)`, "i")
    if (en.test(p) || trAfter.test(p)) out.add(kind)
  }
  return out
}

const KIND_TITLES: Record<SubtaskKind, (topic: string) => string> = {
  architecture: (t) => `Architecture & task decomposition for ${t}`,
  backend: (t) => `Backend implementation: ${t}`,
  frontend: (t) => `Frontend implementation: ${t}`,
  algorithm: (t) => `Core algorithm design: ${t}`,
  tests: (t) => `Test suite for ${t}`,
  review: (t) => `Review & hardening of ${t}`,
  integration: (t) => `Integration & wiring: ${t}`,
  docs: (t) => `Documentation for ${t}`,
}

const KIND_DESCRIPTIONS: Record<SubtaskKind, string> = {
  architecture: "Analyse the repository, define module boundaries, data flow and an execution plan for the other workers. Write the plan to docs/ARCHITECTURE-BRIEF.md.",
  backend: "Implement server-side logic, data models and APIs following the architecture brief. Do not re-scan the whole repository; start from the brief.",
  frontend: "Implement UI components, state and wiring against the backend contract. Start from the architecture brief.",
  algorithm: "Design and implement the performance-critical core with complexity analysis and benchmarks.",
  tests: "Write unit and integration tests that pin down the new behaviour; run the suite and report.",
  review: "Review the diff for correctness, security and consistency. Read only what changed; do not modify files; list concrete issues.",
  integration: "Connect the pieces end-to-end, resolve conflicts and make the feature usable.",
  docs: "Document the feature: README section, inline docs and a changelog entry.",
}

/** Extract a short topic phrase from the prompt for titles. */
export function extractTopic(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim()
  const m = cleaned.match(/^(?:add|build|create|implement|write|design|make|refactor|fix|improve|migrate)\s+(?:an?\s+|the\s+)?(.+?)(?:\s+(?:to|in|for|into|on)\s+.+)?[.!]?$/i)
  const topic = (m?.[1] ?? cleaned).replace(/[.!]+$/, "")
  return topic.length > 64 ? `${topic.slice(0, 61)}…` : topic
}

/**
 * Deterministic heuristic planner: prompt → ordered subtasks with dependencies.
 * Keeps plans small (4–6): architecture → build kinds → (integration) → tests → review; docs/algorithm only when
 * explicitly asked; anything the user negated is excluded.
 */
export function planSubtasks(input: PlanInput, runId = "draft"): Subtask[] {
  const prompt = input.prompt.trim()
  const topic = extractTopic(prompt)
  const excluded = excludedKinds(prompt)
  const mentioned = (k: SubtaskKind) => KIND_WORDS[k].test(prompt) && !excluded.has(k)
  const found = new Map<SubtaskKind, 1 | 2 | 3>()

  if (mentioned("backend")) found.set("backend", 3)
  if (mentioned("frontend")) found.set("frontend", 2)
  if (mentioned("algorithm")) found.set("algorithm", 3)
  if (mentioned("integration")) found.set("integration", 2)
  if (mentioned("docs")) found.set("docs", 1)
  for (const kind of input.focusKinds ?? []) if (!found.has(kind) && !excluded.has(kind) && kind !== "architecture" && kind !== "review") found.set(kind, 2)

  const hasSurface = found.has("backend") || found.has("frontend") || found.has("algorithm")
  if (!hasSurface) {
    if (!excluded.has("backend")) found.set("backend", 2)
    if (/\b(app|user|show|display|view|uygulama|kullan[ıi]c[ıi]|g[öo]ster|ekran)\b/i.test(prompt) && !excluded.has("frontend")) found.set("frontend", 2)
    if (!found.size) found.set(excluded.has("frontend") ? "integration" : "frontend", 2)
  }

  const order: SubtaskKind[] = ["architecture", "algorithm", "backend", "frontend", "integration", "tests", "review", "docs"]
  const kinds = order.filter((k) => {
    if (excluded.has(k)) return false
    if (k === "architecture" || k === "review" || k === "tests") return true
    if (k === "integration") return found.has("integration") || (found.has("backend") && found.has("frontend"))
    return found.has(k)
  })

  const ids = new Map<SubtaskKind, string>()
  const now = Date.now()
  return kinds.map((kind, index) => {
    const id = newId("st")
    ids.set(kind, id)
    const dependsOn: string[] = []
    const arch = ids.get("architecture")
    if (kind !== "architecture" && arch) dependsOn.push(arch)
    if (kind === "frontend" && ids.get("backend")) dependsOn.push(ids.get("backend")!)
    if (kind === "backend" && ids.get("algorithm")) dependsOn.push(ids.get("algorithm")!)
    if (kind === "integration") for (const k of ["backend", "frontend", "algorithm"] as const) if (ids.get(k)) dependsOn.push(ids.get(k)!)
    if (kind === "tests") {
      const upstream = ids.get("integration") ?? ids.get("frontend") ?? ids.get("backend") ?? ids.get("algorithm")
      if (upstream) dependsOn.push(upstream)
    }
    if (kind === "review") dependsOn.push(ids.get("tests") ?? ids.get("integration") ?? ids.get("frontend") ?? ids.get("backend") ?? ids.get("algorithm") ?? arch!)
    if (kind === "docs" && ids.get("review")) dependsOn.push(ids.get("review")!)
    const weight: 1 | 2 | 3 = kind === "architecture" ? 2 : kind === "review" ? 1 : kind === "docs" ? 1 : (found.get(kind) ?? 2)
    return {
      id,
      runId,
      kind,
      title: KIND_TITLES[kind](topic),
      description: KIND_DESCRIPTIONS[kind],
      dependsOn: Array.from(new Set(dependsOn.filter(Boolean))),
      state: "waiting",
      attempts: [],
      files: [],
      commands: [],
      weight,
      progress: 0,
      lastUpdate: now + index,
      answers: [],
      deviations: [],
    }
  })
}
