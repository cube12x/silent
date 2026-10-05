import { describe, expect, it } from "vitest"
import { checkTimeoutFor, E2E_MIN_TIMEOUT_SECS } from "./check"

describe("Denetçi command timeouts (2026-10-03)", () => {
  it("browser test suites get at least 40 minutes; other commands keep the box's timeout", () => {
    expect(checkTimeoutFor("npm run e2e", 900)).toBe(E2E_MIN_TIMEOUT_SECS)
    expect(checkTimeoutFor("npx playwright test", 900)).toBe(E2E_MIN_TIMEOUT_SECS)
    expect(checkTimeoutFor("npm run test:e2e -- --project=chromium", 3000)).toBe(3000)
    expect(checkTimeoutFor("npm run typecheck", 900)).toBe(900)
    expect(checkTimeoutFor("npm test", 900)).toBe(900)
  })
})

describe("soft commands are short (2026-10-05 time-waste hunt)", () => {
  it("softTimeoutFor caps at 10 minutes; the browser floor stays for blocking commands", async () => {
    const { softTimeoutFor, isCheckTimeout, checkTimeoutFor } = await import("./check")
    expect(softTimeoutFor(2400)).toBe(600)
    expect(softTimeoutFor(300)).toBe(300)
    expect(checkTimeoutFor("npm run e2e", 900)).toBe(2400)
    expect(isCheckTimeout({ ok: false, exitCode: null, tail: "timed out after 600 s\n…" })).toBe(true)
    expect(isCheckTimeout({ ok: false, exitCode: 1, tail: "1 failed" })).toBe(false)
  })
})
