import { create } from "zustand"
import { getBackend } from "@/services"
import { isIdle } from "@/engine/status"
import { useBlueprintsStore } from "./blueprints"
import { useRunsStore } from "./runs"

/** Idle delay before a queued update is applied: two quiet minutes (a stage's next box usually starts within one). */
export const UPDATE_IDLE_MS = 2 * 60_000

interface UpdatesState {
  /** Bundle path queued by `silent update`; while set, new blueprint runs are refused (drain). */
  pending: string | null
  idleSince: number | undefined
  applying: boolean
  /** One poll step: read the queue file, apply when idle long enough. Returns true when an update was applied. */
  tick(now?: number): Promise<boolean>
  start(): void
}

let timer: ReturnType<typeof setInterval> | undefined

export const useUpdatesStore = create<UpdatesState>((set, get) => ({
  pending: null,
  idleSince: undefined,
  applying: false,
  async tick(now = Date.now()) {
    const backend = await getBackend()
    const pending = await backend.updatePending().catch(() => null)
    if (!pending) {
      if (get().pending) set({ pending: null, idleSince: undefined })
      return false
    }
    if (get().pending !== pending) set({ pending })
    const idle = isIdle({ running: useBlueprintsStore.getState().running, runs: useRunsStore.getState().runs })
    if (!idle) {
      if (get().idleSince !== undefined) set({ idleSince: undefined })
      return false
    }
    const since = get().idleSince ?? now
    if (get().idleSince === undefined) set({ idleSince: since })
    if (now - since < UPDATE_IDLE_MS || get().applying) return false
    set({ applying: true })
    console.warn("[update] idle long enough — applying", pending)
    try {
      await backend.updateApply(pending)
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.startsWith("retry:")) {
        // The bundle was written moments ago (a build in progress): keep the queue, retry after the next idle window.
        console.warn("[update] postponed", msg)
        set({ applying: false })
        return false
      }
      console.warn("[update] apply failed", e)
      set({ applying: false, pending: null })
      return false
    }
  },
  start() {
    if (timer) return
    timer = setInterval(() => void get().tick(), 10_000)
    void get().tick()
  },
}))
