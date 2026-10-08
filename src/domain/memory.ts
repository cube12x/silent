/** mind = a MindMirror model's memory (scopeId = model id; pinned entries are the Hafıza deposu, the rest is live memory). */
export type MemoryLayer = "user" | "repo" | "session" | "daily" | "mind"

export const MEMORY_LAYERS: readonly MemoryLayer[] = ["user", "repo", "session", "daily", "mind"] as const

export const MEMORY_LAYER_LABELS: Record<MemoryLayer, string> = {
  user: "User Memory",
  repo: "Repo Memory",
  session: "Session Memory",
  daily: "Daily / Phone Context",
  mind: "Mind Memory",
}

export interface MemoryEntry {
  id: string
  layer: MemoryLayer
  /** repo agent id, run id, or device id depending on layer. */
  scopeId?: string
  scopeLabel?: string
  tags: string[]
  title: string
  body: string
  source: string
  pinned: boolean
  createdAt: number
}
