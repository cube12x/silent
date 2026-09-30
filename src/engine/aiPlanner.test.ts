import { describe, expect, it } from "vitest"
import { parseAiPlan } from "./planSchema"
import { buildPlannerPrompt, pickPlannerModel, requestAiPlan, subtasksFromAiPlan } from "./aiPlanner"
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

  it("asks once more with the reply head quoted when the first answer is not a JSON plan", async () => {
    const prompts: string[] = []
    const replies = ["Sure! Before I plan, which engine do you prefer?", JSON.stringify(PLAN)]
    const runner = {
      cliStart: async (req: { prompt: string }, onEvent: (e: RuntimeEvent) => void) => {
        prompts.push(req.prompt)
        const text = replies.shift() ?? ""
        queueMicrotask(() => {
          onEvent({ type: "agentMessage", data: { text } })
          onEvent({ type: "exited", data: { code: 0 } })
        })
        return { cancel: async () => {} }
      },
    }
    const ctx = { prompt: "Anime app", models: TEST_MODELS, policy: { architecture: "frontier", backend: "strong", frontend: "strong", algorithm: "frontier", tests: "fast", review: "strong", integration: "strong", docs: "fast" }, language: "tr" } as Parameters<typeof requestAiPlan>[1]
    const res = await requestAiPlan(runner, ctx, TEST_MODELS[3])
    expect(res.plan.subtasks.length).toBeGreaterThan(0)
    expect(prompts.length).toBe(2)
    expect(prompts[1]).toMatch(/PREVIOUS REPLY WAS NOT A VALID JSON PLAN \(reply began: "Sure! Before I plan/)
  })
  it("names what came back when both attempts fail", async () => {
    const runner = {
      cliStart: async (_req: { prompt: string }, onEvent: (e: RuntimeEvent) => void) => {
        queueMicrotask(() => {
          onEvent({ type: "agentMessage", data: { text: "" } })
          onEvent({ type: "exited", data: { code: 0 } })
        })
        return { cancel: async () => {} }
      },
    }
    const ctx = { prompt: "x", models: TEST_MODELS, policy: { architecture: "frontier", backend: "strong", frontend: "strong", algorithm: "frontier", tests: "fast", review: "strong", integration: "strong", docs: "fast" }, language: "tr" } as Parameters<typeof requestAiPlan>[1]
    await expect(requestAiPlan(runner, ctx, TEST_MODELS[3])).rejects.toThrow(/no valid JSON after 2 attempts \(empty reply\)/)
  })
  it("offers the pool with strengths and asks for a per-task model", () => {
    const ctx = { prompt: "Build a game", models: TEST_MODELS, policy: { architecture: "frontier", backend: "strong", frontend: "strong", algorithm: "frontier", tests: "fast", review: "frontier", integration: "strong", docs: "fast" }, language: "en" } as Parameters<typeof buildPlannerPrompt>[0]
    const prompt = buildPlannerPrompt(ctx)
    expect(prompt).toMatch(/MODELS IN THE POOL/)
    expect(prompt).toMatch(/claude:opus — frontier — deepest reasoning/)
    expect(prompt).toMatch(/codex:gpt-6-astra — frontier — frontier; creative gameplay/)
    expect(prompt).toMatch(/Browser-driving tasks must use a Claude model/)
  })

  it("never plans with a CLI whose structured output is unverified", () => {
    const models = [
      { id: "gemini-3.8-flash-high", providerId: "antigravity" as const, displayName: "G", source: "catalog" as const, tier: "strong" as const, isDefault: true },
      { id: "grok-4.7", providerId: "grok" as const, displayName: "Grok", source: "catalog" as const, tier: "frontier" as const },
      ...TEST_MODELS,
    ]
    expect(["codex", "claude"]).toContain(pickPlannerModel(models)?.providerId)
  })
})

describe("planner rules for parallel verification, per-area integration and targeted verify commands (Faz 1)", () => {
  const ctx = { prompt: "Rebuild the graphics", models: TEST_MODELS, policy: { architecture: "frontier", backend: "strong", frontend: "strong", algorithm: "frontier", tests: "fast", review: "frontier", integration: "strong", docs: "fast" }, language: "tr" } as Parameters<typeof buildPlannerPrompt>[0]
  it("asks for one browser task per act/area instead of one long play-through", () => {
    const p = buildPlannerPrompt(ctx)
    expect(p).toMatch(/one `needsBrowser: true` task PER act\/area/)
    expect(p).toMatch(/depend only on the integration task/)
  })
  it("makes build tasks wire their own area and keeps the final integration task short", () => {
    const p = buildPlannerPrompt(ctx)
    expect(p).toMatch(/wires its own area into the app/)
    expect(p).toMatch(/integration task .*weight 1 or 2/)
  })
  it("requires a one-line verify command per task and carries it into the subtask", () => {
    const p = buildPlannerPrompt(ctx)
    expect(p).toMatch(/`verify`: ONE shell line/)
    const plan = parseAiPlan(JSON.stringify({ ...PLAN, subtasks: PLAN.subtasks.map((s) => ({ ...s, verify: `npx vitest run tests/${s.key} && npx tsc --noEmit` })) }))!
    expect(plan.subtasks[0].verify).toBe("npx vitest run tests/a && npx tsc --noEmit")
    expect(parseAiPlan(JSON.stringify(PLAN))!.subtasks[0].verify).toBe("")
    const subtasks = subtasksFromAiPlan(plan, "run_v")
    expect(subtasks[0].verify).toBe("npx vitest run tests/a && npx tsc --noEmit")
  })
})
