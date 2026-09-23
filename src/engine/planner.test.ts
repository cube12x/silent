import { describe, expect, it } from "vitest"
import { extractTopic, planSubtasks } from "./planner"

describe("planner", () => {
  it("always brackets work with architecture first and review after tests", () => {
    const plan = planSubtasks({ prompt: "Add a real-time notification system to the Reach repository." })
    expect(plan[0].kind).toBe("architecture")
    const kinds = plan.map((s) => s.kind)
    expect(kinds.indexOf("tests")).toBeLessThan(kinds.indexOf("review"))
    expect(kinds).toContain("backend")
    expect(kinds).toContain("integration")
  })

  it("is deterministic in structure for the same prompt", () => {
    const a = planSubtasks({ prompt: "Implement an algorithm to optimise the scheduler" }).map((s) => s.kind)
    const b = planSubtasks({ prompt: "Implement an algorithm to optimise the scheduler" }).map((s) => s.kind)
    expect(a).toEqual(b)
    expect(a).toContain("algorithm")
  })

  it("wires dependencies so nothing depends on itself or on a later task", () => {
    const plan = planSubtasks({ prompt: "Build a dashboard page with an API endpoint and tests" })
    const index = new Map(plan.map((s, i) => [s.id, i]))
    for (const s of plan) {
      for (const dep of s.dependsOn) {
        expect(dep).not.toBe(s.id)
        expect(index.get(dep)!).toBeLessThan(index.get(s.id)!)
      }
    }
    const frontend = plan.find((s) => s.kind === "frontend")!
    const backend = plan.find((s) => s.kind === "backend")!
    expect(frontend.dependsOn).toContain(backend.id)
  })

  it("honours gateway focus kinds", () => {
    const plan = planSubtasks({ prompt: "Ship the thing", focusKinds: ["frontend"] })
    expect(plan.map((s) => s.kind)).toContain("frontend")
  })

  it("extracts a readable topic", () => {
    expect(extractTopic("Add a real-time notification system to the Reach repository.")).toBe("real-time notification system")
  })
})
