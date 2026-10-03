/** 2026-10-03: a Playwright suite that grew to 11 specs took 15+ minutes under host load and hit the Denetçi's 900 s
 * limit; the fixer then chased a phantom failure. Browser suites get a higher floor; everything else keeps the box's value. */
export const E2E_MIN_TIMEOUT_SECS = 40 * 60

const BROWSER_SUITE_RE = /\b(e2e|playwright|cypress|webdriver|puppeteer)\b/i

export function checkTimeoutFor(command: string, boxTimeoutSecs: number): number {
  return BROWSER_SUITE_RE.test(command) ? Math.max(boxTimeoutSecs, E2E_MIN_TIMEOUT_SECS) : boxTimeoutSecs
}
