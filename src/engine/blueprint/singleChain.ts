import { isModelRejected, quotaResetAt } from "@/engine/modelErrors"
import { handoverBlock } from "@/engine/executor"
import { pickHandoverTarget, type DosageWeights } from "@/engine/dosage"
import type { SingleRunResult } from "./single"

/** Hops a single box may take across models (pool + fallback + waits) before it gives up. */
const MAX_HOPS = 6

export interface SingleChainOptions {
  mainRef: string
  pool: string[]
  weights?: DosageWeights
  fallbackRef?: string
  /** Start one CLI session on `ref`; `extra` is the HANDOVER brief appended to the prompt. */
  start: (ref: string, extra?: string) => { done: Promise<SingleRunResult>; cancel: () => Promise<void> }
  /** The current cancel handle (session or quota wait) — the box's stop button calls it. */
  onCancel: (cancel: () => void) => void
  unavailable: () => string[]
  markUnavailable: (ref: string, reason: string) => void
  log: (line: string) => void
  /** A quota wait started (reset time) or ended (undefined): the box shows a live countdown. */
  onWait: (until: number | undefined) => void
  now?: () => number
  /** Sleep `ms`; false when cancelled. */
  sleep?: (ms: number, register: (abort: () => void) => void) => Promise<boolean>
  maxWaitMs?: number
}

const defaultSleep = (ms: number, register: (abort: () => void) => void) =>
  new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(true), ms)
    register(() => {
      clearTimeout(t)
      resolve(false)
    })
  })

const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/**
 * A single-mode box's session with model fallbacks. A model that rejects the work (quota, plan limit, no access) hands
 * the session to the next pool model by dosage, then the fallback model; when none is left, the box waits for the
 * earliest announced quota reset and continues on that model. 2026-10-05: "Sanat AI" handed Gemini's quota error to
 * Claude once, Claude hit its plan limit 12 minutes later and the box went red — while Gemini's quota had already reset.
 */
export async function runSingleChain(o: SingleChainOptions): Promise<{ res: SingleRunResult; usedRef: string }> {
  const now = o.now ?? Date.now
  const sleep = o.sleep ?? defaultSleep
  const maxWait = o.maxWaitMs ?? 6 * 3_600_000
  let ref = o.mainRef
  let handle = o.start(ref)
  o.onCancel(() => void handle.cancel())
  let res = await handle.done
  let tokens = res.tokens
  const tried: string[] = []
  const resets = new Map<string, number>()
  for (let hop = 0; hop < MAX_HOPS && !res.ok && res.error && res.error !== "cancelled" && isModelRejected(res.error); hop++) {
    o.markUnavailable(ref, res.error)
    tried.push(ref)
    const until = quotaResetAt(res.error, now())
    if (until) resets.set(ref, until)
    let target = pickHandoverTarget({ current: ref, pool: o.pool, unavailable: [...o.unavailable(), ...tried], weights: o.weights, fallbackRef: o.fallbackRef })
    if (!target) {
      const next = [...resets].sort((a, b) => a[1] - b[1])[0]
      if (!next || next[1] - now() > maxWait) {
        o.log(`✖ ${ref} rejected (${res.error.slice(0, 120)}) and no backup model is left${resets.size ? " — the earliest quota reset is too far away" : ""} — wire backup models into the box or set a fallback model in Settings`)
        break
      }
      o.log(`⏳ every model of this box is out of quota — waiting for ${next[0]} until ${hhmm(next[1])}, then continuing there`)
      o.onWait(next[1])
      // A minute of slack after long waits: providers reset on their own clock.
      const delay = Math.max(0, next[1] - now()) + (next[1] - now() > 60_000 ? 60_000 : 0)
      const woke = await sleep(delay, (abort) => o.onCancel(abort))
      o.onWait(undefined)
      if (!woke) {
        res = { ...res, ok: false, error: "cancelled" }
        break
      }
      resets.delete(next[0])
      target = next[0]
      tried.splice(tried.indexOf(target), 1)
    }
    o.log(`↪ handover ${ref} → ${target} (${res.error.slice(0, 80)})`)
    const extra = handoverBlock({ fromModel: ref, reason: res.error, lastMessage: res.text.trim().slice(-1500) || undefined })
    handle = o.start(target, extra)
    o.onCancel(() => void handle.cancel())
    ref = target
    res = await handle.done
    tokens += res.tokens
  }
  return { res: { ...res, tokens }, usedRef: ref }
}
