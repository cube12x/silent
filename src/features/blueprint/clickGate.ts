/**
 * Click bookkeeping for canvas nodes. Four quick clicks open a node's terminal (AI) or folder (Build); a double
 * click runs the node. The browser fires `dblclick` after the 2nd AND the 4th click, so without this gate four
 * clicks on a finished node restarted its orchestration twice instead of opening the terminal (2026-09-30).
 * The component defers the double-click run; `click` reports when that pending run must be cancelled.
 */
export interface ClickGate {
  /** Register a single click. `quad` = 4th quick click on the same node; `cancelPending` = this click continues a sequence past a double click. */
  click(nodeId: string, now: number): { quad: boolean; cancelPending: boolean }
  /** Whether the double click that just fired may (after the deferral) run the node. False inside a quad sequence. */
  runOnDoubleClick(nodeId: string, now: number): boolean
}

export function createClickGate(windowMs = 600): ClickGate {
  let id = ""
  let n = 0
  let at = 0
  let suppressUntil = 0
  return {
    click(nodeId, now) {
      if (nodeId === id && now - at < windowMs) n += 1
      else {
        id = nodeId
        n = 1
      }
      at = now
      const cancelPending = n >= 3
      if (n >= 4) {
        n = 0
        suppressUntil = now + windowMs
        return { quad: true, cancelPending: true }
      }
      return { quad: false, cancelPending }
    },
    runOnDoubleClick(nodeId, now) {
      if (now < suppressUntil) return false
      return nodeId === id && n === 2
    },
  }
}

/** How long a double-click run waits for a possible 3rd click before it fires. */
export const DOUBLE_CLICK_RUN_DELAY_MS = 350
