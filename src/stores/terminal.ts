import { create } from "zustand"
import type { TerminalLine } from "@/domain"

const MEMORY_CAP = 1500
const THROTTLE_MS = 100

/**
 * Terminal output lives outside the runs store so thousands of log lines never re-render the app.
 * Lines are buffered and published at most every 100 ms; only components that read a subtask's
 * version re-render.
 */
interface TerminalState {
  lines: Record<string, TerminalLine[]>
  versions: Record<string, number>
  append(subtaskId: string, line: TerminalLine): void
  replace(subtaskId: string, lines: TerminalLine[]): void
  get(subtaskId: string): TerminalLine[]
}

const buffers = new Map<string, TerminalLine[]>()
let timer: ReturnType<typeof setTimeout> | undefined

export const useTerminalStore = create<TerminalState>((set, get) => ({
  lines: {},
  versions: {},
  append(subtaskId, line) {
    const buf = buffers.get(subtaskId) ?? []
    buf.push(line)
    buffers.set(subtaskId, buf)
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      const lines = { ...get().lines }
      const versions = { ...get().versions }
      for (const [id, pending] of buffers) {
        const merged = [...(lines[id] ?? []), ...pending]
        lines[id] = merged.length > MEMORY_CAP ? merged.slice(merged.length - MEMORY_CAP) : merged
        versions[id] = (versions[id] ?? 0) + 1
      }
      buffers.clear()
      set({ lines, versions })
    }, THROTTLE_MS)
  },
  replace(subtaskId, lines) {
    set({ lines: { ...get().lines, [subtaskId]: lines.slice(-MEMORY_CAP) }, versions: { ...get().versions, [subtaskId]: (get().versions[subtaskId] ?? 0) + 1 } })
  },
  get(subtaskId) {
    return get().lines[subtaskId] ?? EMPTY
  },
}))

const EMPTY: TerminalLine[] = []

/** Test helper: flush pending buffers synchronously. */
export function flushTerminalBuffers(): void {
  if (timer) {
    clearTimeout(timer)
    timer = undefined
  }
  const state = useTerminalStore.getState()
  const lines = { ...state.lines }
  const versions = { ...state.versions }
  for (const [id, pending] of buffers) {
    const merged = [...(lines[id] ?? []), ...pending]
    lines[id] = merged.length > MEMORY_CAP ? merged.slice(merged.length - MEMORY_CAP) : merged
    versions[id] = (versions[id] ?? 0) + 1
  }
  buffers.clear()
  useTerminalStore.setState({ lines, versions })
}
