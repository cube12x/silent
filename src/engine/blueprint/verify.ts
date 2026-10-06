import type { LoadLevel } from "@/engine/loadGuard"

export interface LaneResult {
  lane: string
  /** The lane's CLI session finished normally. */
  ok: boolean
  /** The lane's `# VERIFY` report (may be empty). */
  text: string
}

export interface LaneVerdicts {
  ok: string[]
  findings: LaneResult[]
  /** Lanes that could not be driven at all (host overloaded, app did not start, session died) — not product findings. */
  inconclusive: LaneResult[]
}

/** `# VERIFY\n- OK`, possibly followed by prose about what was played (lanes often append their notes). */
const OK_RE = /^#\s*VERIFY\s*\n?-\s*OK\b/i
const INCONCLUSIVE_RE = /-\s*INCONCLUSIVE\b|could not be verified|lane not verified|not verified\b|unable to verify|could not verify|machine is overloaded|load average|game loop (barely|does not|did not) advance/i
const FINDING_RE = /^\s*-\s*\[(blocker|high|medium|low|critical)\]/im

/**
 * 2026-10-02: three of four lanes reported "could not be verified — load average 520" and the fixer burned 24k
 * tokens on it. A lane that could not be driven is inconclusive: it is replayed later, never "fixed".
 */
export function judgeLanes(results: LaneResult[]): LaneVerdicts {
  const out: LaneVerdicts = { ok: [], findings: [], inconclusive: [] }
  for (const r of results) {
    const text = r.text.trim()
    if (r.ok && OK_RE.test(text) && !FINDING_RE.test(text)) out.ok.push(r.lane)
    else if (INCONCLUSIVE_RE.test(text) || (!r.ok && !FINDING_RE.test(text)) || (r.ok && !text)) out.inconclusive.push(r)
    else out.findings.push(r)
  }
  return out
}

/** Lanes are far heavier than CLI workers (each builds the project and drives a Chromium): at most two, one under load. */
export function laneCap(level: LoadLevel, hostCap: number): number {
  return Math.max(1, Math.min(level === "ok" ? 2 : 1, hostCap))
}

/** One lane session's ceiling (2026-10-05: lanes ran up to 25 min each on an overloaded host before giving up). */
export const VERIFY_LANE_TIMEOUT_SECS = 20 * 60

/** The lane reported it could not be driven (`# VERIFY - INCONCLUSIVE: …`). */
export function isInconclusiveLane(text: string): boolean {
  const t = text.trim()
  // Same rule as judgeLanes: a lane with real findings is never "could not be driven".
  return !FINDING_RE.test(t) && !OK_RE.test(t) && INCONCLUSIVE_RE.test(t)
}

/**
 * The red verify box's note. A lane whose model rejected the work (quota, plan limit) is named as such with a hand-over
 * hint — 2026-10-06: four Kimi lanes hit the 5-hour limit and the box said "host overloaded".
 */
export function verifyNote(i: { lanes: number; findings: number; inconclusive: number; rejected?: { ref: string; error: string } }): string {
  if (i.findings) return `${i.findings}/${i.lanes} lanes with findings${i.inconclusive ? `, ${i.inconclusive} inconclusive` : ""}`
  if (i.rejected) return `${i.inconclusive}/${i.lanes} lanes not run: ${i.rejected.ref} rejected (${i.rejected.error.replace(/\s+/g, " ").slice(0, 100)}) — hand over the box to a browser-capable model with quota, or re-run later`
  return `${i.inconclusive}/${i.lanes} lanes inconclusive (host overloaded or app did not start) — re-run later`
}
