import { describe, expect, it } from "vitest"
import { COMMANDS_PER_SUBTASK, COMMAND_TEXT_MAX, clipText, recordCommand } from "./retention"

describe("DB retention of worker output (2026-10-04: silent.db reached 56 MB — 17 MB were terminal lines over 2000 chars, 11 MB subtask `commands` holding whole file bodies)", () => {
  it("clipText keeps short text as-is and marks how much was cut", () => {
    expect(clipText("ok", 10)).toBe("ok")
    const long = "x".repeat(30)
    expect(clipText(long, 10)).toBe(`${"x".repeat(10)}… [+20 chars]`)
  })
  it("recordCommand clips each command and keeps only the newest N", () => {
    const one = recordCommand([], "y".repeat(COMMAND_TEXT_MAX + 5))
    expect(one[0]!.length).toBeLessThan(COMMAND_TEXT_MAX + 30)
    let list: string[] = []
    for (let i = 0; i < COMMANDS_PER_SUBTASK + 3; i++) list = recordCommand(list, `c${i}`)
    expect(list).toHaveLength(COMMANDS_PER_SUBTASK)
    expect(list[0]).toBe("c3")
    expect(list.at(-1)).toBe(`c${COMMANDS_PER_SUBTASK + 2}`)
  })
})
