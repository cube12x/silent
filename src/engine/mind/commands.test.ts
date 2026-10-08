import { describe, expect, it } from "vitest"
import { parseMindCommand } from "./commands"

describe("parseMindCommand", () => {
  it("is null for plain messages", () => {
    expect(parseMindCommand("merhaba")).toBeNull()
    expect(parseMindCommand("  /")).toEqual({ kind: "unknown", name: "" })
  })
  it("switches a half's model", () => {
    expect(parseMindCommand("/model eylem codex:gpt-5.6-luna")).toEqual({ kind: "model", actor: "eylem", modelRef: "codex:gpt-5.6-luna" })
    expect(parseMindCommand("/model bilinç claude:opus")).toEqual({ kind: "model", actor: "bilinc", modelRef: "claude:opus" })
    expect(parseMindCommand("/model eylem nope")).toEqual({ kind: "unknown", name: "model" })
  })
  it("parses modes, effort, memory and the rest", () => {
    expect(parseMindCommand("/plan")).toEqual({ kind: "plan" })
    expect(parseMindCommand("/act")).toEqual({ kind: "act" })
    expect(parseMindCommand("/effort high")).toEqual({ kind: "effort", actor: undefined, effort: "high" })
    expect(parseMindCommand("/effort bilinc xhigh")).toEqual({ kind: "effort", actor: "bilinc", effort: "xhigh" })
    expect(parseMindCommand("/effort ultra")).toEqual({ kind: "unknown", name: "effort" })
    expect(parseMindCommand("/hatirla Ben İzmir'de yaşıyorum")).toEqual({ kind: "hatirla", text: "Ben İzmir'de yaşıyorum" })
    expect(parseMindCommand("/hatırla")).toEqual({ kind: "unknown", name: "hatirla" })
    expect(parseMindCommand("/unut mem_1")).toEqual({ kind: "unut", id: "mem_1" })
    expect(parseMindCommand("/durum")).toEqual({ kind: "durum" })
    expect(parseMindCommand("/reset")).toEqual({ kind: "reset" })
    expect(parseMindCommand("/help")).toEqual({ kind: "yardim" })
    expect(parseMindCommand("/foo bar")).toEqual({ kind: "unknown", name: "foo" })
  })
})
