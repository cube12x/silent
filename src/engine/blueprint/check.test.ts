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
