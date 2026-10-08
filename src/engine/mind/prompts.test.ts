import { describe, expect, it } from "vitest"
import type { MemoryEntry } from "@/domain"
import { newMindModel } from "@/domain"
import { bilincBrief, eylemBrief, memoryExtractPrompt, memorySection, terminalBrief } from "./prompts"

const model = { ...newMindModel({ id: "m1", name: "Deneme", now: 1, bilincRef: "claude:opus", eylemRef: "codex:gpt-5.6-luna" }), workspace: "/tmp/ws" }
const mem: MemoryEntry[] = [
  { id: "a", layer: "mind", scopeId: "m1", tags: [], title: "", body: "Kullanıcı İzmir'de yaşıyor", source: "auto", pinned: false, createdAt: 2 },
  { id: "b", layer: "mind", scopeId: "m1", tags: [], title: "Dil", body: "Türkçe cevap ver", source: "user", pinned: true, createdAt: 1 },
]

describe("mind briefs", () => {
  it("Bilinç is read-only and carries the EYLEM contract", () => {
    const b = bilincBrief(model, mem, "Atarus sinemasına bak")
    expect(b).toContain("READ-ONLY")
    expect(b).toContain("EYLEM:")
    expect(b).toContain("DÖNÜŞ:")
    expect(b).toContain("codex:gpt-5.6-luna")
    expect(b).toContain("# USER\nAtarus sinemasına bak")
    expect(b).not.toContain("PLAN MODE")
  })
  it("plan mode forbids the EYLEM block", () => {
    const b = bilincBrief({ ...model, mode: "plan" }, [], "x")
    expect(b).toContain("PLAN MODE")
    expect(b).not.toContain("DÖNÜŞ: <exactly")
  })
  it("memory lists the depot first and the gateway is prepended when set", () => {
    const s = memorySection(mem)
    expect(s.indexOf("[depot] Dil: Türkçe cevap ver")).toBeLessThan(s.indexOf("İzmir"))
    const b = bilincBrief({ ...model, gateway: { prompt: "Senior backend engineer, respect existing architecture" } }, [], "x")
    expect(b).toContain("# GATEWAY")
    expect(b).toContain("Senior backend engineer")
    expect(b.toLowerCase()).toContain("architecture")
  })
  it("Eylem gets the tools it may use and the exact block", () => {
    const b = eylemBrief({ ...model, tools: { ...model.tools, browser: false } }, mem, "bak", "Üç film var.", { steps: ["siteyi aç"], returns: "seanslar", raw: "EYLEM:\n1. siteyi aç\nDÖNÜŞ: seanslar" })
    expect(b).toContain("Forbidden: browser")
    expect(b).toContain("# EYLEM:\n1. siteyi aç")
    expect(b).toContain("# SONUÇ")
    expect(b).toContain("Workspace: /tmp/ws")
    expect(b).toContain("# BİLİNÇ SAID\nÜç film var.")
  })
  it("memory extraction and terminal briefs carry the user's text", () => {
    const m = memoryExtractPrompt("Ben Ali", "Merhaba Ali", undefined, mem)
    expect(m).toContain("# HATIRLA")
    expect(m).toContain("# EXISTING MEMORY")
    expect(m).not.toContain("# EYLEM")
    const t = terminalBrief(model, [], "npm test")
    expect(t).toContain("TERMINAL")
    expect(t).toContain("# USER\nnpm test")
  })
})
