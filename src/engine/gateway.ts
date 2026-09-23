import type { AgentPermissions, BehaviorTrait, GatewayProfile, SubtaskKind, TaskStyle } from "@/domain"

interface Rule {
  test: RegExp
  apply: (p: MutableProfile) => void
}

type MutableProfile = {
  role?: string
  traits: Set<BehaviorTrait>
  guardrails: Set<string>
  contextPriority: Set<string>
  permissions: Partial<AgentPermissions>
  taskStyle?: TaskStyle
  quality: Set<string>
  focus: Set<SubtaskKind>
}

const ROLE_RULES: Array<{ test: RegExp; role: string; focus: SubtaskKind[]; context: string[] }> = [
  { test: /senior\s+backend|backend\s+engineer|api\s+engineer/i, role: "Senior Backend Engineer", focus: ["backend", "integration"], context: ["API contracts", "data models", "service boundaries"] },
  { test: /frontend|ui\s+engineer|react\s+developer|design\s+engineer/i, role: "Senior Frontend Engineer", focus: ["frontend"], context: ["component tree", "design system", "state management"] },
  { test: /full[-\s]?stack/i, role: "Full-Stack Engineer", focus: ["backend", "frontend", "integration"], context: ["end-to-end flows", "API contracts"] },
  { test: /architect/i, role: "Software Architect", focus: ["architecture", "review"], context: ["module boundaries", "dependency graph", "ADRs"] },
  { test: /devops|sre|platform\s+engineer|infra/i, role: "Platform / SRE Engineer", focus: ["integration", "tests"], context: ["CI pipeline", "deployment config", "observability"] },
  { test: /security|pentest|appsec/i, role: "Security Engineer", focus: ["review"], context: ["auth flows", "input validation", "secrets handling"] },
  { test: /qa|test\s+engineer|sdet/i, role: "Test Engineer", focus: ["tests"], context: ["test suites", "fixtures", "coverage gaps"] },
  { test: /data\s+engineer|ml\s+engineer|algorithm/i, role: "Algorithms & Data Engineer", focus: ["algorithm"], context: ["hot paths", "data pipelines", "benchmarks"] },
  { test: /reviewer|code\s+review/i, role: "Code Reviewer", focus: ["review"], context: ["recent diffs", "style conventions"] },
]

const RULES: Rule[] = [
  { test: /respect|follow|keep|preserve|existing\s+(architecture|structure|patterns)|current\s+architecture/i, apply: (p) => { p.traits.add("respect-architecture"); p.guardrails.add("Do not restructure modules or change public interfaces without an explicit task."); p.contextPriority.add("existing architecture") } },
  { test: /check|run|verify|pass(ing)?\s+tests|before\s+claiming|before\s+(saying|marking)\s+(done|complete)/i, apply: (p) => { p.traits.add("verify-with-tests"); p.guardrails.add("Run the relevant test suite and report results before declaring completion."); p.quality.add("Tests pass before completion is claimed"); p.permissions.runTests = true } },
  { test: /avoid|no|minimal|unnecessary\s+dependenc/i, apply: (p) => { p.traits.add("minimal-dependencies"); p.guardrails.add("Do not add dependencies unless the task cannot be done with what is installed."); p.permissions.network = false } },
  { test: /stability|stable|reliab|robust|production[-\s]?grade/i, apply: (p) => { p.traits.add("stability-first"); p.quality.add("Stability over novelty; prefer the smallest safe change"); p.taskStyle = p.taskStyle ?? "surgical" } },
  { test: /clean\s+code|readable|maintainab|clarity/i, apply: (p) => { p.traits.add("clean-code"); p.quality.add("Readable, well-named, small functions") } },
  { test: /explain|document\s+(your|the)\s+(decision|reason)|rationale/i, apply: (p) => { p.traits.add("explain-decisions"); p.quality.add("Every non-obvious decision is explained in the summary") } },
  { test: /secur|secret|credential|injection|owasp/i, apply: (p) => { p.traits.add("security-conscious"); p.guardrails.add("Never log or commit secrets; validate all external input."); p.contextPriority.add("security-sensitive code paths") } },
  { test: /perform|latency|fast|throughput|memory/i, apply: (p) => { p.traits.add("performance-aware"); p.quality.add("Measure before optimising; no regressions on hot paths") } },
  { test: /no\s+(big|large|speculative|unrelated)\s+refactor|don'?t\s+refactor|only\s+touch/i, apply: (p) => { p.traits.add("no-speculative-refactors"); p.guardrails.add("Do not refactor code unrelated to the task."); p.taskStyle = "surgical" } },
  { test: /ask\s+(before|first)|confirm\s+before|never\s+delete|do\s+not\s+delete/i, apply: (p) => { p.traits.add("ask-before-destructive"); p.guardrails.add("Stop and ask before deleting files, dropping data or force-pushing."); p.permissions.fileCreateDelete = false } },
  { test: /never\s+(commit|push)|do\s+not\s+(commit|push)|no\s+git\s+(commit|push)/i, apply: (p) => { p.permissions.gitCommit = false; p.permissions.gitPush = false; p.guardrails.add("Do not commit or push; leave changes in the working tree.") } },
  { test: /(may|can|should|allowed\s+to)\s+commit/i, apply: (p) => { p.permissions.gitCommit = true } },
  { test: /read[-\s]?only|do\s+not\s+(modify|write|change)\s+(files|code)/i, apply: (p) => { p.permissions.write = false; p.permissions.fileCreateDelete = false; p.guardrails.add("Read-only: propose changes as diffs, do not write files.") } },
  { test: /explor|experiment|prototype|spike/i, apply: (p) => { p.taskStyle = "exploratory" } },
  { test: /typescript|strict\s+types|no\s+any/i, apply: (p) => { p.quality.add("Strict TypeScript; no `any`") } },
  { test: /test[-\s]?driven|tdd|write\s+tests?\s+first/i, apply: (p) => { p.traits.add("verify-with-tests"); p.quality.add("Test-driven: failing test first") ; p.focus.add("tests") } },
]

/**
 * Rule-based interpreter: natural-language Gateway prompt → structured GatewayProfile.
 * Deterministic and explainable; a model-assisted refinement can layer on top later.
 */
export function interpretGateway(prompt: string): GatewayProfile {
  const text = prompt.trim()
  const p: MutableProfile = {
    traits: new Set(),
    guardrails: new Set(),
    contextPriority: new Set(),
    permissions: {},
    quality: new Set(),
    focus: new Set(),
  }

  for (const r of ROLE_RULES) {
    if (r.test.test(text)) {
      p.role = r.role
      r.focus.forEach((k) => p.focus.add(k))
      r.context.forEach((c) => p.contextPriority.add(c))
      break
    }
  }
  for (const rule of RULES) if (rule.test.test(text)) rule.apply(p)

  // Git push is never enabled by a Gateway prompt.
  p.permissions.gitPush = false

  const role = p.role ?? (text ? "Repository Engineer" : "General Assistant")
  const taskStyle = p.taskStyle ?? "balanced"
  if (p.contextPriority.size === 0) p.contextPriority.add("files touched by the task")
  if (p.quality.size === 0) p.quality.add("Working, verified change with a clear summary")

  const traits = Array.from(p.traits)
  const summary = text
    ? `${role} · ${taskStyle} · ${traits.length ? traits.slice(0, 3).map(humanTrait).join(", ") : "default guardrails"}`
    : `${role} · balanced · default guardrails`

  return {
    role,
    behaviorProfile: traits,
    guardrails: Array.from(p.guardrails),
    contextPriority: Array.from(p.contextPriority),
    permissions: p.permissions,
    taskStyle,
    qualityExpectations: Array.from(p.quality),
    focusKinds: Array.from(p.focus),
    summary,
  }
}

export function humanTrait(t: BehaviorTrait): string {
  return t.replace(/-/g, " ")
}

/** Render the profile as a system brief the worker receives with every job. */
export function renderGatewayBrief(profile: GatewayProfile): string {
  const lines = [`Role: ${profile.role}.`, `Task style: ${profile.taskStyle}.`]
  if (profile.guardrails.length) lines.push("Guardrails:", ...profile.guardrails.map((g) => `- ${g}`))
  if (profile.qualityExpectations.length) lines.push("Quality bar:", ...profile.qualityExpectations.map((q) => `- ${q}`))
  if (profile.contextPriority.length) lines.push(`Prioritise context: ${profile.contextPriority.join(", ")}.`)
  return lines.join("\n")
}
