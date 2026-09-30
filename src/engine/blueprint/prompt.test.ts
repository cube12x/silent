import { describe, expect, it } from "vitest"
import { aiTaskText, buildAiPrompt, effectivePurpose, extractReport, isRepoUrl, repoName } from "./prompt"

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
    expect(at("Module shadowing")).toBeGreaterThan(at("Work inside"))
    expect(buildAiPrompt({ wired: "Build a game" })).not.toContain("Module shadowing")
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

describe("Dönüştürücü prompt", () => {
  it("role donusturucu gets the converter policy after 'Work inside' and before base instructions", () => {
    const p = buildAiPrompt({ wired: "Sprites for the game", role: "donusturucu", existingProjectAt: "/p", converterTool: true, instructions: "persona" })
    const at = (s: string) => p.indexOf(s)
    expect(at("DÖNÜŞTÜRÜCÜ")).toBeGreaterThan(at("Work inside"))
    expect(at("# Base instructions")).toBeGreaterThan(at("DÖNÜŞTÜRÜCÜ"))
    expect(p).toContain("# CONVERTED")
  })
  it("converterTool adds the on-demand toolkit line to any AI, and only then", () => {
    expect(buildAiPrompt({ wired: "x", existingProjectAt: "/p", converterTool: true })).toContain("Converter toolkit")
    expect(buildAiPrompt({ wired: "x", existingProjectAt: "/p" })).not.toContain("Converter toolkit")
    // the role block already explains the tool; no duplicate toolkit line
    expect(buildAiPrompt({ wired: "x", role: "donusturucu", converterTool: true }).split("donusturucu.py --help").length).toBe(2)
  })
  it("converted manifests reach the next AI as 'Converted assets', not as an Eylem work order", () => {
    const t = aiTaskText({ wired: "integrate", reports: [{ title: "Dönüştürücü", report: "# CONVERTED\n- a.png → assets/converted/a.png · removebg", kind: "donusturucu" }] })
    expect(t).toContain("Converted assets")
    expect(t).toContain("assets/converted/a.png")
    expect(t).not.toContain("EYLEM")
    const both = aiTaskText({ wired: "fix", reports: [{ title: "B", report: "# FINDINGS\n- x", kind: "bilinc" }, { title: "D", report: "# CONVERTED\n- y", kind: "donusturucu" }] })
    expect(both.indexOf("EYLEM")).toBeGreaterThanOrEqual(0)
    expect(both.indexOf("Converted assets")).toBeGreaterThan(both.indexOf("EYLEM"))
  })
  it("a Dönüştürücü's own purpose is its task; other roles keep purpose for Reload only", () => {
    expect(effectivePurpose("donusturucu", "  32x32 frames ", undefined)).toBe("32x32 frames")
    expect(effectivePurpose("donusturucu", "32x32 frames", "reload text")).toBe("reload text")
    expect(effectivePurpose(undefined, "regenerate art", undefined)).toBeUndefined()
    expect(effectivePurpose("bilinc", "look", undefined)).toBeUndefined()
    expect(effectivePurpose("donusturucu", "   ", undefined)).toBeUndefined()
  })
  it("image-capable providers are told to use their image tool for drawn art (single sessions too)", () => {
    expect(buildAiPrompt({ wired: "Draw sprites", imageTool: true })).toMatch(/IMAGE GENERATION tool/)
    expect(buildAiPrompt({ wired: "Draw sprites", imageTool: true })).toMatch(/Never substitute script-drawn placeholder boxes/)
    expect(buildAiPrompt({ wired: "Draw sprites" })).not.toMatch(/IMAGE GENERATION/)
    expect(buildAiPrompt({ wired: "Audit", imageTool: true, role: "bilinc" })).not.toMatch(/IMAGE GENERATION/)
  })
  it("extractReport keeps a # CONVERTED manifest", () => {
    expect(extractReport("chatter\n# CONVERTED\n- x → y · convert\n# UNRESOLVED\n- none")).toMatch(/^# CONVERTED/)
    expect(extractReport("# FINDINGS\n- a\n\nlater # CONVERTED\n- b")).toMatch(/^# CONVERTED/)
  })
})
