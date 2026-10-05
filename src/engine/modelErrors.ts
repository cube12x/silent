/**
 * Does this worker error mean the MODEL (not the task) is unusable — unknown/unsupported model, no access on the
 * current plan, auth failure, exhausted quota? Such failures must not be retried on the same model: the executor
 * falls straight through to the next model in the pool (2026-09-29: Kimi highspeed answered 401 "subscription does
 * not have access" and two tasks died with fallbacks available).
 */
export function isModelRejected(message: string): boolean {
  return (
    /model.{0,40}(is not supported|not supported|unsupported|not available|unavailable|does not exist|unknown model|invalid model)|unsupported model|invalid_model|model_not_found/i.test(message) ||
    /auth_error|authentication (failed|error)|unauthori[sz]ed|not authenticated|(does not|doesn't|do not) have access|no access to|not entitled|insufficient[_ ]quota|quota exceeded|exceeded your (current )?quota|usage limit|(daily|weekly|monthly|usage|token|request) limit reached|too many requests|out of credits|no credits|resource[_ ]exhausted|rate[ _-]?limit|overloaded|upgrade (to|your) .{0,30}plan/i.test(message) ||
    // HTTP status codes only when they look like a status, never a bare number (2026-10-05: `src/api.ts:401:5` and the
    // runtime's "2400 s limit reached, stopped at a quiet moment" timeout text used to mark the model dead).
    /\b(?:http|status(?: code)?|error|code)[ :]*(401|403|429)\b|\b(401|403|429) (unauthorized|forbidden|too many)/i.test(message)
  )
}
