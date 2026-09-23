export type MemoryLayer = "user" | "repo" | "session" | "daily"

export const MEMORY_LAYERS: readonly MemoryLayer[] = ["user", "repo", "session", "daily"] as const

export const MEMORY_LAYER_LABELS: Record<MemoryLayer, string> = {
  user: "User Memory",
  repo: "Repo Memory",
  session: "Session Memory",
  daily: "Daily / Phone Context",
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
