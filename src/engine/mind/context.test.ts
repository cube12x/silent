import { describe, expect, it } from "vitest"
import type { Message } from "@/domain"
import { sharedContext, terminalNote } from "./context"

const msg = (role: Message["role"], content: string, actor?: "bilinc" | "eylem" | "tek", extra: Partial<Message> = {}): Message => ({ id: content.slice(0, 8), chatId: "c", role, content, blocks: actor ? [{ type: "mind-actor", actor, modelRef: "x:y" }] : [], createdAt: 1, ...extra })

describe("sharedContext", () => {
  it("renders user, Bilinç, Eylem and terminal rows in order and skips streaming/failed ones", () => {
    const s = sharedContext([
      msg("user", "Atarus sinemasına bak"),
      msg("assistant", "Üç film olabilir.", "bilinc"),
      msg("assistant", "# SONUÇ\n3 film: A, B, C", "eylem"),
      msg("system", "[terminal] $ ls\na.txt"),
      msg("system", "Plan modu açık"),
      msg("assistant", "yarım", "bilinc", { streaming: true }),
      msg("assistant", "", "eylem", { error: "boom" }),
    ])
    expect(s.startsWith("# ORTAK BAĞLAM")).toBe(true)
    expect(s).toContain("[Sen] Atarus sinemasına bak")
    expect(s).toContain("[Bilinç] Üç film olabilir.")
    expect(s).toContain("[Eylem] # SONUÇ\n3 film: A, B, C")
    expect(s).toContain("[Terminal] $ ls\na.txt")
    expect(s).not.toContain("Plan modu")
    expect(s).not.toContain("yarım")
    expect(s).not.toContain("boom")
  })
  it("is empty without messages and clips long ones within the budget", () => {
    expect(sharedContext([])).toBe("")
    const long = "x".repeat(2000)
    const s = sharedContext([msg("user", long), msg("user", "son")], { maxChars: 100 })
    expect(s).toContain(" … ")
    expect(s.length).toBeLessThan(400)
    const many = Array.from({ length: 40 }, (_, i) => msg("user", `mesaj ${i}`))
    const t = sharedContext(many, { maxMessages: 5 })
    expect(t).toContain("mesaj 39")
    expect(t).not.toContain("mesaj 30")
  })
  it("terminalNote keeps the command and a clipped result", () => {
    expect(terminalNote("ls", "a.txt\nb.txt")).toBe("[terminal] $ ls\na.txt\nb.txt")
    expect(terminalNote("ls", "")).toBe("[terminal] $ ls\n(çıktı yok)")
  })
})
