import { describe, expect, it } from "vitest"
import { aiTaskText, buildAiPrompt, extractReport, isRepoUrl, repoName } from "./prompt"

describe("Özel AI prompt", () => {
  it("orders policy → existing project → repos → base instructions → purpose → wired → extra", () => {
    const p = buildAiPrompt({
      purpose: "fix what is broken",
      wired: "# Mod isteği\nAdd double jump",
      extraPrompt: "New files in ./inbox",
      instructions: "You are the modder of this repo. Never touch save formats.",
      existingProjectAt: "/tmp/game",
      refPaths: [{ name: "engine", path: "/tmp/game/.silent/refs/engine", hint: "the upstream engine" }],
      fills: [{ kinds: ["sfx"], folder: "assets/ses" }],
    })
    const at = (s: string) => p.indexOf(s)
    expect(at("uydurma")).toBeGreaterThanOrEqual(0)
    expect(at("Work inside the existing project at /tmp/game")).toBeGreaterThan(at("uydurma"))
    expect(at("/tmp/game/.silent/refs/engine — the upstream engine")).toBeGreaterThan(at("Work inside"))
    expect(at("# Base instructions\nYou are the modder")).toBeGreaterThan(at("refs/engine"))
    expect(at("Purpose: fix what is broken")).toBeGreaterThan(at("# Base instructions"))
    expect(at("# Mod isteği")).toBeGreaterThan(at("Purpose:"))
    expect(at("New files in ./inbox")).toBeGreaterThan(at("# Mod isteği"))
  })
  it("skips empty blocks and keeps a plain wired prompt as-is", () => {
    expect(buildAiPrompt({ wired: "Build a game" })).toBe("Build a game")
    expect(buildAiPrompt({ wired: "Build a game", instructions: "   ", refPaths: [] })).toBe("Build a game")
  })
  it("base instructions alone are not a task", () => {
    expect(aiTaskText({ wired: "", instructions: "persona" } as never)).toBe("")
    expect(aiTaskText({ wired: "", purpose: "regenerate art" })).toBe("Purpose: regenerate art")
  })
  it("accepts https/git@ repo urls and names the clone folder from the url", () => {
    expect(isRepoUrl("https://github.com/acme/engine.git")).toBe(true)
    expect(isRepoUrl("git@github.com:acme/engine.git")).toBe(true)
    expect(isRepoUrl("github.com/acme/engine")).toBe(false)
    expect(isRepoUrl("https://x y")).toBe(false)
    expect(repoName({ url: "https://github.com/acme/engine.git" })).toBe("engine")
    expect(repoName({ url: "git@github.com:acme/Engine" })).toBe("Engine")
    expect(repoName({ url: "https://github.com/acme/engine", name: " base " })).toBe("base")
  })
  it("Bilinç gets the read-only policy first; Eylem gets the reports as its task", () => {
    const b = buildAiPrompt({ wired: "Find the bugs", role: "bilinc" })
    expect(b.startsWith("You are the BİLİNÇ")).toBe(true)
    expect(b).toContain("# ACTIONS")
    expect(b.endsWith("Find the bugs")).toBe(true)
    const e = buildAiPrompt({ wired: "", role: "eylem", reports: [{ title: "Bilinç · Fable", report: "# FINDINGS\n- a.ts:1 x\n# ACTIONS\n1. fix a.ts" }] })
    expect(e).toContain("EYLEM (action) step")
    expect(e).toContain("## Report from Bilinç · Fable")
    expect(aiTaskText({ wired: "", reports: [{ title: "b", report: "r" }] })).not.toBe("")
    expect(aiTaskText({ wired: "", reports: [] })).toBe("")
  })
  it("keeps only the report part of a Bilinç reply", () => {
    expect(extractReport("Still reading…\n\nChecking x.\n\n# FINDINGS\n- a.ts:1 bug\n# ACTIONS\n1. fix")).toBe("# FINDINGS\n- a.ts:1 bug\n# ACTIONS\n1. fix")
    expect(extractReport("no headings at all")).toBe("no headings at all")
  })
})
