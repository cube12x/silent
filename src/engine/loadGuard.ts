/**
 * Load guard (Faz 3, 2026-09-30): when the host is overloaded, fewer AI sessions run at once. Four CLIs plus
 * a `tauri build` pushed the machine into swap and blacked out the Silent window during the Batman graphics
 * run; running 1–2 workers on a starved host finishes sooner than 4 that all crawl.
 */
export interface HostLoad {
  /** 1-minute load average. */
  load1: number
  /** Logical CPU count (≥ 1). */
  cpus: number
  /** Swap in use, 0..100, when the host reports it. */
  swapUsedPct?: number
}

export type LoadLevel = "ok" | "high" | "critical"

/**
 * macOS keeps its swap files allocated, so "swap used %" sits near 90 for hours while load1 is low (2026-10-01:
 * the cap flapped 1↔2 on 90/91 %). Swap therefore only counts when it is nearly full; CPU load is the main signal.
 */
export function loadLevel(h: HostLoad): LoadLevel {
  const cpus = Math.max(1, h.cpus)
  if (h.load1 > 2 * cpus || (h.swapUsedPct ?? 0) >= 97) return "critical"
  if (h.load1 > cpus || (h.swapUsedPct ?? 0) >= 93) return "high"
  return "ok"
}

/** Hysteresis: a level change needs two consecutive samples, so a 1 % swap wobble does not flip the cap. */
export function settleLevel(prev: LoadLevel, pending: LoadLevel | undefined, sample: LoadLevel): { level: LoadLevel; pending: LoadLevel | undefined } {
  if (sample === prev) return { level: prev, pending: undefined }
  if (pending === sample) return { level: sample, pending: undefined }
  return { level: prev, pending: sample }
}

/** How many AI sessions may run concurrently at this load; Infinity = no extra cap beyond the run's own limit. */
export function concurrencyCap(h: HostLoad | undefined): number {
  if (!h) return Infinity
  const level = loadLevel(h)
  return level === "critical" ? 1 : level === "high" ? 2 : Infinity
}

/** Run `fn` over `items` with at most `limit` in flight; resolves in input order. */
export async function mapWithLimit<T, R>(items: T[], limit: () => number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  let inFlight = 0
  return new Promise<R[]>((resolve, reject) => {
    const pump = () => {
      if (next >= items.length && inFlight === 0) return resolve(out)
      while (next < items.length && inFlight < Math.max(1, limit())) {
        const i = next++
        inFlight += 1
        fn(items[i]).then((r) => {
          out[i] = r
          inFlight -= 1
          pump()
        }, reject)
      }
    }
    pump()
  })
}
