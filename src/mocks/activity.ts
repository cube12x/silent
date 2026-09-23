export interface ActivityItem {
  id: string
  kind: "run" | "chat" | "agent" | "memory" | "system" | "phone"
  title: string
  detail?: string
  refId?: string
  refRoute?: string
  ok: boolean
  at: number
}

const H = 3600_000
const now = Date.now()

export const MOCK_ACTIVITY: ActivityItem[] = [
  { id: "act_1", kind: "run", title: "Silent Code · vectorise diffusion step", detail: "running · Opus, Fable, Gemini", refRoute: "/runs/run_diffusion", ok: true, at: now - 0.3 * H },
  { id: "act_2", kind: "run", title: "Silent Code · real-time notification system", detail: "completed · 6 subtasks · $1.84", refRoute: "/runs/run_notify", ok: true, at: now - 2 * H },
  { id: "act_3", kind: "memory", title: "Repo memory updated · Reach", detail: "Reconnect storm on ws close", refRoute: "/memory", ok: true, at: now - 4 * H },
  { id: "act_4", kind: "chat", title: "Reach · notification fan-out", detail: "Codex · 2 messages", refRoute: "/chat/chat_3", ok: true, at: now - 4 * H },
  { id: "act_5", kind: "phone", title: "Note from Pixel 9", detail: "Ship notification feature before Friday demo", refRoute: "/phone", ok: true, at: now - 11 * H },
  { id: "act_6", kind: "run", title: "Silent Code · fix NaN in pressure solver", detail: "recovered via fallback · Gemini → Opus", refRoute: "/runs/run_nan", ok: false, at: now - 20 * H },
  { id: "act_7", kind: "system", title: "Codex CLI detected", detail: "codex-cli 0.153.2 · /opt/homebrew/bin/codex", refRoute: "/settings", ok: true, at: now - 24 * H },
  { id: "act_8", kind: "agent", title: "Repo agent created · Market Terminal", detail: "read-only · Codex", refRoute: "/agents/agent_terminal", ok: true, at: now - 70 * H },
]
