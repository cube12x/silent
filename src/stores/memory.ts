import { create } from "zustand"
import type { MemoryEntry } from "@/domain"
import { getBackend } from "@/services"
import { newId } from "@/lib/ids"

interface MemoryState {
  entries: MemoryEntry[]
  load(): Promise<void>
  add(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry>
  remove(id: string): Promise<void>
  /** MindMirror: pin/unpin (depot ↔ live) or edit one entry. */
  update(id: string, patch: Partial<MemoryEntry>): Promise<void>
}

/** Repo memory shown inside an agent's detail page (kept small on purpose). */
export const useMemoryStore = create<MemoryState>((set, get) => ({
  entries: [],
  async load() {
    const backend = await getBackend()
    set({ entries: await backend.db.memory.list() })
  },
  async add(entry) {
    const full: MemoryEntry = { ...entry, id: newId("mem"), createdAt: Date.now() }
    set({ entries: [full, ...get().entries] })
    const backend = await getBackend()
    await backend.db.memory.upsert(full)
    return full
  },
  async remove(id) {
    set({ entries: get().entries.filter((e) => e.id !== id) })
    const backend = await getBackend()
    await backend.db.memory.delete(id)
  },
  async update(id, patch) {
    const current = get().entries.find((e) => e.id === id)
    if (!current) return
    const next = { ...current, ...patch }
    set({ entries: get().entries.map((e) => (e.id === id ? next : e)) })
    const backend = await getBackend()
    await backend.db.memory.upsert(next)
  },
}))
