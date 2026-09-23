import { create } from "zustand"
import type { MemoryEntry, MemoryLayer } from "@/domain"
import { getBackend } from "@/services"
import { newId } from "@/lib/ids"

interface MemoryState {
  entries: MemoryEntry[]
  load(): Promise<void>
  add(entry: Omit<MemoryEntry, "id" | "createdAt"> & { createdAt?: number }): Promise<MemoryEntry>
  togglePin(id: string): Promise<void>
  remove(id: string): Promise<void>
  countByLayer(): Record<MemoryLayer, number>
  countForScope(scopeId: string): number
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  entries: [],
  async load() {
    const backend = await getBackend()
    set({ entries: await backend.db.memory.list() })
  },
  async add(entry) {
    const full: MemoryEntry = { ...entry, id: newId("mem"), createdAt: entry.createdAt ?? Date.now() }
    set({ entries: [full, ...get().entries] })
    const backend = await getBackend()
    await backend.db.memory.upsert(full)
    return full
  },
  async togglePin(id) {
    const entry = get().entries.find((e) => e.id === id)
    if (!entry) return
    const next = { ...entry, pinned: !entry.pinned }
    set({ entries: get().entries.map((e) => (e.id === id ? next : e)) })
    const backend = await getBackend()
    await backend.db.memory.upsert(next)
  },
  async remove(id) {
    set({ entries: get().entries.filter((e) => e.id !== id) })
    const backend = await getBackend()
    await backend.db.memory.delete(id)
  },
  countByLayer() {
    const out: Record<MemoryLayer, number> = { user: 0, repo: 0, session: 0, daily: 0 }
    for (const e of get().entries) out[e.layer] += 1
    return out
  },
  countForScope(scopeId) {
    return get().entries.filter((e) => e.scopeId === scopeId).length
  },
}))
