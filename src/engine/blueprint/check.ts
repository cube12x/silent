/** 2026-10-03: a Playwright suite that grew to 11 specs took 15+ minutes under host load and hit the Denetçi's 900 s
 * limit; the fixer then chased a phantom failure. Browser suites get a higher floor; everything else keeps the box's value. */
export const E2E_MIN_TIMEOUT_SECS = 40 * 60

const BROWSER_SUITE_RE = /\b(e2e|playwright|cypress|webdriver|puppeteer)\b/i

export function checkTimeoutFor(command: string, boxTimeoutSecs: number): number {
  return BROWSER_SUITE_RE.test(command) ? Math.max(boxTimeoutSecs, E2E_MIN_TIMEOUT_SECS) : boxTimeoutSecs
}

/** Soft commands (2026-10-05): a soft `npm run e2e` timed out at 40 min in 7 stages and never once passed — and a soft
 * result never changes the chain. Soft commands get at most 10 minutes; the browser floor applies to blocking ones only. */
export const SOFT_MAX_TIMEOUT_SECS = 10 * 60
/** A soft command that timed out this many runs in a row is skipped until it passes, is edited, or is replayed by hand. */
export const SOFT_SKIP_AFTER_TIMEOUTS = 2

export function softTimeoutFor(boxTimeoutSecs: number): number {
  return Math.min(boxTimeoutSecs, SOFT_MAX_TIMEOUT_SECS)
}

/** Whether a check result is a time limit (the backend reports `exitCode: null` and a "timed out" tail). */
export function isCheckTimeout(r: { ok: boolean; exitCode: number | null | undefined; tail: string }): boolean {
  return !r.ok && (r.exitCode === null || r.exitCode === undefined) && /^\s*timed out\b/i.test(r.tail)
}
