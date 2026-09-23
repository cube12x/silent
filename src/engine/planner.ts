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

interface Signal {
  kind: SubtaskKind
  patterns: RegExp[]
  weight: 1 | 2 | 3
}

const SIGNALS: Signal[] = [
  { kind: "backend", patterns: [/\b(api|endpoint|server|database|db|schema|migration|service|queue|websocket|auth|backend|worker|cron)\b/i], weight: 3 },
  { kind: "frontend", patterns: [/\b(ui|screen|page|component|frontend|dashboard|form|modal|button|react|layout|css|design)\b/i], weight: 2 },
  { kind: "algorithm", patterns: [/\b(algorithm|optimi[sz]e|performance|complexity|scheduler|ranking|search index|matching|graph|parser|compiler|encoding|compression)\b/i], weight: 3 },
  { kind: "tests", patterns: [/\b(test|tests|coverage|spec|e2e|regression|verify)\b/i], weight: 2 },
  { kind: "docs", patterns: [/\b(doc|docs|documentation|readme|changelog|guide)\b/i], weight: 1 },
  { kind: "integration", patterns: [/\b(integrat|wire|connect|hook up|glue|migrate|refactor|real-?time|notification|sync|pipeline)/i], weight: 2 },
]

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
  architecture: "Analyse the repository, define module boundaries, data flow and an execution plan for the other workers.",
  backend: "Implement server-side logic, data models and APIs following the architecture brief.",
  frontend: "Implement UI components, state and wiring against the backend contract.",
  algorithm: "Design and implement the performance-critical core with complexity analysis and benchmarks.",
  tests: "Write unit and integration tests that pin down the new behaviour; run the suite and report.",
  review: "Independently review the diff for correctness, security and consistency; request fixes.",
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
 * Always starts with architecture and ends with integration → tests → review (+docs when asked or large).
 */
export function planSubtasks(input: PlanInput, runId = "draft"): Subtask[] {
  const prompt = input.prompt.trim()
  const topic = extractTopic(prompt)
  const found = new Map<SubtaskKind, 1 | 2 | 3>()

  for (const signal of SIGNALS) {
    if (signal.patterns.some((p) => p.test(prompt))) found.set(signal.kind, signal.weight)
  }
  for (const kind of input.focusKinds ?? []) {
    if (!found.has(kind) && kind !== "architecture" && kind !== "review") found.set(kind, 2)
  }

  // A coding prompt with no explicit surface defaults to backend + frontend.
  const hasSurface = found.has("backend") || found.has("frontend") || found.has("algorithm")
  if (!hasSurface) {
    found.set("backend", 2)
    if (/\b(app|user|show|display|view)\b/i.test(prompt)) found.set("frontend", 2)
  }

  const large = prompt.length > 80 || found.size >= 3
  const order: SubtaskKind[] = ["architecture", "algorithm", "backend", "frontend", "integration", "tests", "review", "docs"]
  const kinds: SubtaskKind[] = order.filter((k) => {
    if (k === "architecture" || k === "review") return true
    if (k === "tests") return true
    if (k === "integration") return found.has("integration") || (found.has("backend") && found.has("frontend"))
    if (k === "docs") return found.has("docs") || large
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
    if (kind === "integration") {
      for (const k of ["backend", "frontend", "algorithm"] as const) if (ids.get(k)) dependsOn.push(ids.get(k)!)
    }
    if (kind === "tests") {
      const upstream = ids.get("integration") ?? ids.get("frontend") ?? ids.get("backend") ?? ids.get("algorithm")
      if (upstream) dependsOn.push(upstream)
    }
    if (kind === "review" && ids.get("tests")) dependsOn.push(ids.get("tests")!)
    if (kind === "docs" && ids.get("review")) dependsOn.push(ids.get("review")!)

    const weight: 1 | 2 | 3 = kind === "architecture" || kind === "review" ? 2 : kind === "docs" ? 1 : (found.get(kind) ?? 2)
    return {
      id,
      runId,
      kind,
      title: KIND_TITLES[kind](topic),
      description: KIND_DESCRIPTIONS[kind],
      dependsOn: Array.from(new Set(dependsOn)),
      state: "waiting",
      attempts: [],
      files: [],
      commands: [],
      weight,
      progress: 0,
      lastUpdate: now + index,
    }
  })
}
