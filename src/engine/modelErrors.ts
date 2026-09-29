/**
 * Does this worker error mean the MODEL (not the task) is unusable — unknown/unsupported model, no access on the
 * current plan, auth failure, exhausted quota? Such failures must not be retried on the same model: the executor
 * falls straight through to the next model in the pool (2026-09-29: Kimi highspeed answered 401 "subscription does
 * not have access" and two tasks died with fallbacks available).
 */
export function isModelRejected(message: string): boolean {
  return (
    /model.{0,40}(is not supported|not supported|unsupported|not available|unavailable|does not exist|unknown model|invalid model)|unsupported model|invalid_model|model_not_found/i.test(message) ||
    /auth_error|authentication (failed|error)|unauthori[sz]ed|not authenticated|(does not|doesn't|do not) have access|no access to|not entitled|insufficient[_ ]quota|quota exceeded|resource[_ ]exhausted|rate[ _-]?limit|\b(401|403|429)\b|upgrade (to|your) .{0,30}plan/i.test(message)
  )
}
