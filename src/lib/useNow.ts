import * as React from "react"

/** The current time, re-read every `intervalMs` while `active` (no timer at all otherwise). */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    // First tick soon (not synchronously in the effect), then every interval.
    const first = setTimeout(() => setNow(Date.now()), 0)
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [intervalMs, active])
  return now
}
