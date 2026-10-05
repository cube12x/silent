import { describe, expect, it } from "vitest"

describe("formatCountdown (2026-10-05 quota wait)", () => {
  it("shows h:mm:ss over an hour and m:ss below, never negative", async () => {
    const { formatCountdown } = await import("./format")
    expect(formatCountdown((1 * 3600 + 42 * 60 + 5) * 1000)).toBe("1:42:05")
    expect(formatCountdown(247_000)).toBe("4:07")
    expect(formatCountdown(500)).toBe("0:01")
    expect(formatCountdown(-5)).toBe("0:00")
  })
})
