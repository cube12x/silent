/**
 * Ortak bağlam: the two halves of a MindMirror model run in separate CLI sessions, so Bilinç never saw what Eylem did
 * and Eylem never saw the earlier conversation. Every brief carries the same compact transcript of the last turns
 * (user, Bilinç, Eylem, terminal) so their contexts match (user request 2026-10-09).
 */
import type { Message } from "@/domain"

export interface SharedContextOptions {
  /** Newest messages kept (after filtering). */
  maxMessages?: number
  /** Characters kept per message (head + tail). */
  maxChars?: number
  /** Total character budget of the block. */
  budget?: number
}

const DEFAULTS: Required<SharedContextOptions> = { maxMessages: 16, maxChars: 700, budget: 6000 }

function clip(text: string, max: number): string {
  const t = text.replace(/\s+\n/g, "\n").trim()
  if (t.length <= max) return t
  const head = Math.floor(max * 0.7)
  return `${t.slice(0, head)} … ${t.slice(-(max - head - 3))}`
}

function labelOf(m: Message): string | undefined {
  if (m.role === "user") return "Sen"
  if (m.role === "system") return m.content.startsWith("[terminal]") ? "Terminal" : undefined
  const b = m.blocks.find((x) => x.type === "mind-actor")
  if (!b || b.type !== "mind-actor") return "Model"
  return b.actor === "bilinc" ? "Bilinç" : b.actor === "eylem" ? "Eylem" : b.actor === "tek" ? "Model" : undefined
}

/** `# ORTAK BAĞLAM` block (empty string when there is nothing to share). Streaming and failed messages are skipped. */
export function sharedContext(messages: Message[], opts: SharedContextOptions = {}): string {
  const o = { ...DEFAULTS, ...opts }
  const rows: string[] = []
  for (const m of messages) {
    if (m.streaming || m.error) continue
    const label = labelOf(m)
    if (!label) continue
    const body = label === "Terminal" ? m.content.replace(/^\[terminal\]\s*/, "") : m.content
    if (!body.trim()) continue
    rows.push(`[${label}] ${clip(body, o.maxChars)}`)
  }
  let kept = rows.slice(-o.maxMessages)
  while (kept.length > 1 && kept.join("\n").length > o.budget) kept = kept.slice(1)
  if (!kept.length) return ""
  return `# ORTAK BAĞLAM (the shared transcript of this model — Bilinç, Eylem and the terminal all see the same thing; newest last)\n${kept.join("\n")}`
}

/** The chat note a terminal run leaves behind so the chat halves know what happened there. */
export function terminalNote(command: string, result: string, maxChars = 400): string {
  return `[terminal] $ ${command.trim()}\n${clip(result, maxChars) || "(çıktı yok)"}`
}
