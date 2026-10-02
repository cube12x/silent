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
