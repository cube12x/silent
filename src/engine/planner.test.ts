import { describe, expect, it } from "vitest"
import { excludedKinds, extractTopic, planSubtasks } from "./planner"

describe("planner", () => {
  it("keeps plans small: architecture, build kinds, tests, review — no docs unless asked", () => {
    const kinds = planSubtasks({ prompt: "Add a real-time notification system to the Reach repository with websocket fan-out and an API endpoint." }).map((s) => s.kind)
    expect(kinds[0]).toBe("architecture")
    expect(kinds).toContain("backend")
    expect(kinds).toContain("tests")
    expect(kinds.at(-1)).toBe("review")
    expect(kinds).not.toContain("docs")
    expect(kinds).not.toContain("algorithm")
    expect(kinds.length).toBeLessThanOrEqual(6)
  })

  it("adds algorithm only when explicitly and positively asked", () => {
    expect(planSubtasks({ prompt: "Implement an algorithm to optimise the scheduler" }).map((s) => s.kind)).toContain("algorithm")
    expect(planSubtasks({ prompt: "Build the anime app backend and frontend, do not write any algorithm" }).map((s) => s.kind)).not.toContain("algorithm")
    expect(planSubtasks({ prompt: "Anime uygulaması yap, algoritma yazma, sadece backend ve arayüz." }).map((s) => s.kind)).not.toContain("algorithm")
  })

  it("honours negations in English and Turkish", () => {
    expect(excludedKinds("Add the feature, no tests please")).toContain("tests")
    expect(excludedKinds("without documentation")).toContain("docs")
    expect(excludedKinds("skip review")).toContain("review")
    expect(excludedKinds("test yazmayın, dokümantasyon istemiyorum")).toEqual(new Set(["tests", "docs"]))
    expect(excludedKinds("inceleme olmasın")).toContain("review")
    expect(excludedKinds("algoritma gerek yok")).toContain("algorithm")
    expect(excludedKinds("Add tests and docs")).toEqual(new Set())
    const kinds = planSubtasks({ prompt: "Backend API ekle, test yazma, inceleme olmasın" }).map((s) => s.kind)
    expect(kinds).not.toContain("tests")
    expect(kinds).not.toContain("review")
    expect(kinds).toContain("backend")
  })

  it("wires dependencies so nothing depends on itself or on a later task", () => {
    const plan = planSubtasks({ prompt: "Build a dashboard page with an API endpoint and tests" })
    const index = new Map(plan.map((s, i) => [s.id, i]))
    for (const s of plan) for (const dep of s.dependsOn) {
      expect(dep).not.toBe(s.id)
      expect(index.get(dep)!).toBeLessThan(index.get(s.id)!)
    }
    expect(plan.find((s) => s.kind === "frontend")!.dependsOn).toContain(plan.find((s) => s.kind === "backend")!.id)
  })

  it("extracts a readable topic", () => {
    expect(extractTopic("Add a real-time notification system to the Reach repository.")).toBe("real-time notification system")
  })
})
