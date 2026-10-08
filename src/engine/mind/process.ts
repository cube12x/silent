/**
 * The visible process of a half while it works: runtime events folded into message blocks (command cards, touched
 * files) so the chat bubble shows what Eylem is doing instead of "Eylem yapıyor…". Pure; the store applies it.
 */
import type { MessageBlock, RuntimeEvent } from "@/domain"

/** Fold one event into the blocks (mutates and returns `blocks`; `true` when something changed). */
export function applyProcessEvent(blocks: MessageBlock[], e: RuntimeEvent): boolean {
  switch (e.type) {
    case "commandStarted":
      blocks.push({ type: "task-card", title: e.data.command, status: "running", command: e.data.command })
      return true
    case "commandCompleted": {
      let i = -1
      for (let k = blocks.length - 1; k >= 0; k--) {
        const b = blocks[k]!
        if (b.type === "task-card" && b.status === "running" && (b.command === e.data.command || i < 0)) {
          i = k
          if (b.command === e.data.command) break
        }
      }
      const detail = e.data.outputTail.split("\n").filter((l) => l.trim()).slice(-6).join("\n")
      if (i >= 0) blocks[i] = { type: "task-card", title: e.data.command, status: e.data.exitCode === 0 || e.data.exitCode === null ? "done" : "failed", command: e.data.command, detail }
      else blocks.push({ type: "task-card", title: e.data.command, status: e.data.exitCode === 0 || e.data.exitCode === null ? "done" : "failed", command: e.data.command, detail })
      return true
    }
    case "fileChanged": {
      const label = `files:${e.data.kind}`
      const existing = blocks.find((b): b is Extract<MessageBlock, { type: "context" }> => b.type === "context" && b.label === label)
      if (existing) {
        if (existing.items.includes(e.data.path)) return false
        existing.items.push(e.data.path)
      } else blocks.push({ type: "context", label, items: [e.data.path] })
      return true
    }
    default:
      return false
  }
}

/** Keep the last `max` non-empty lines (the live tail shown in the bubble). */
export function pushTail(tail: string[], line: string, max = 8): string[] {
  const t = line.replace(/\s+$/, "")
  if (!t.trim()) return tail
  const next = [...tail, t.length > 200 ? `${t.slice(0, 199)}…` : t]
  return next.length > max ? next.slice(next.length - max) : next
}
