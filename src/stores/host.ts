import { create } from "zustand"
import { getBackend } from "@/services"
import { loadLevel, settleLevel, type HostLoad, type LoadLevel } from "@/engine/loadGuard"

/** Host load poll (Faz 3): every 10 s while the app is open; the executor and the Paralel fan-out read `cap()`. */
interface HostState {
  load?: HostLoad
  level: LoadLevel
  /** Max concurrent AI sessions the host can take right now (Infinity = no cap). */
  cap(): number
  /** Start polling (idempotent). */
  start(): void
  /** Test/preview hook. */
  set(load: HostLoad): void
}

let timer: ReturnType<typeof setInterval> | undefined
let pending: LoadLevel | undefined

export const useHostStore = create<HostState>()((set, get) => ({
  load: undefined,
  level: "ok",
  cap: () => (get().level === "critical" ? 1 : get().level === "high" ? 2 : Infinity),
  set: (load) => set({ load, level: loadLevel(load) }),
  start: () => {
    if (timer) return
    const tick = async () => {
      try {
        const load = await (await getBackend()).hostLoad()
        const settled = settleLevel(get().level, pending, loadLevel(load))
        pending = settled.pending
        if (settled.level !== get().level) console.warn(`[host] load ${settled.level}: load1=${load.load1.toFixed(1)} cpus=${load.cpus} swap=${load.swapUsedPct?.toFixed(0) ?? "?"}%`)
        set({ load, level: settled.level })
      } catch {
        /* no backend (tests) */
      }
    }
    void tick()
    timer = setInterval(() => void tick(), 10_000)
  },
}))
