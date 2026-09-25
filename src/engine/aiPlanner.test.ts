import { describe, expect, it } from "vitest"
import { parseAiPlan } from "./planSchema"
import { buildPlannerPrompt, requestAiPlan, subtasksFromAiPlan } from "./aiPlanner"
import { TEST_MODELS } from "./testModels"
import type { RuntimeEvent } from "@/domain"

const PLAN = { summary: "ok", subtasks: [{ key: "a", kind: "backend", title: "API", description: "d", dependsOn: [], weight: 2, tier: "strong", effort: "medium", rationale: "r" }, { key: "b", kind: "tests", title: "Tests", description: "d", dependsOn: ["a"], weight: 1, tier: "fast", effort: "low", rationale: "r" }], questions: [{ id: "q1", question: "Which sources?", why: "legal", options: ["licensed", "any"] }], assumptions: [], excluded: ["algorithm"] }

describe("AI planner", () => {
  it("parses strict JSON and JSON embedded in prose, tolerating partial fields", () => {
    expect(parseAiPlan(JSON.stringify(PLAN))?.subtasks).toHaveLength(2)
    expect(parseAiPlan(`Here is the plan:\n${JSON.stringify(PLAN)}\nDone.`)?.questions[0].options).toEqual(["licensed", "any"])
    expect(parseAiPlan("not json")).toBeNull()
    const partial = parseAiPlan(JSON.stringify({ subtasks: [{ kind: "frontend", title: "UI" }, { kind: "nope", title: "x" }] }))
    expect(partial?.subtasks).toHaveLength(1)
    expect(partial?.subtasks[0].tier).toBe("strong")
  })

  it("converts keys to ids and wires dependencies", () => {
    const subtasks = subtasksFromAiPlan(PLAN as never, "run_1")
    expect(subtasks[1].dependsOn).toEqual([subtasks[0].id])
    expect(subtasks[0].tierHint).toBe("strong")
    expect(subtasks[1].effort).toBe("low")
  })

  it("asks the CLI with the schema and returns the plan", async () => {
    const seen: string[] = []
    const runner = {
      cliStart: async (req: { prompt: string; outputSchema?: unknown; sandbox: string }, onEvent: (e: RuntimeEvent) => void) => {
        seen.push(req.prompt)
        expect(req.outputSchema).toBeTruthy()
        expect(req.sandbox).toBe("read-only")
        queueMicrotask(() => {
          onEvent({ type: "agentMessage", data: { text: JSON.stringify(PLAN) } })
          onEvent({ type: "exited", data: { code: 0 } })
        })
        return { cancel: async () => {} }
      },
    }
    const ctx = { prompt: "Anime app, algoritma yazma", models: TEST_MODELS, policy: { architecture: "frontier", backend: "strong", frontend: "strong", algorithm: "frontier", tests: "fast", review: "frontier", integration: "strong", docs: "fast" } as const, language: "tr" as const }
    const res = await requestAiPlan(runner, ctx, TEST_MODELS[3])
    expect(res.plan.excluded).toContain("algorithm")
    expect(seen[0]).toMatch(/DO NOT decide silently/)
    expect(buildPlannerPrompt({ ...ctx, previous: { title: "v1", summaries: ["did X"], deviations: [] } })).toMatch(/CONTINUES A PREVIOUS RUN/)
  })

  it("offers the pool with strengths and asks for a per-task model", () => {
    const ctx = { prompt: "Build a game", models: TEST_MODELS, policy: { architecture: "frontier", backend: "strong", frontend: "strong", algorithm: "frontier", tests: "fast", review: "frontier", integration: "strong", docs: "fast" }, language: "en" } as Parameters<typeof buildPlannerPrompt>[0]
    const prompt = buildPlannerPrompt(ctx)
    expect(prompt).toMatch(/MODELS IN THE POOL/)
    expect(prompt).toMatch(/claude:opus — frontier — deepest reasoning/)
    expect(prompt).toMatch(/codex:gpt-6-astra — frontier — frontier; creative gameplay/)
    expect(prompt).toMatch(/Browser-driving tasks must use a Claude model/)
  })
})
