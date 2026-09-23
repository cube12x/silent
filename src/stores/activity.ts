import { create } from "zustand"
import type { ActivityItem } from "@/mocks/activity"
import { getBackend } from "@/services"
import { newId } from "@/lib/ids"

interface ActivityState {
  items: ActivityItem[]
  load(): Promise<void>
  push(item: Omit<ActivityItem, "id" | "at"> & { at?: number }): Promise<void>
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  items: [],
  async load() {
    const backend = await getBackend()
    set({ items: await backend.db.activity.list(80) })
  },
  async push(item) {
    const full: ActivityItem = { ...item, id: newId("act"), at: item.at ?? Date.now() }
    set({ items: [full, ...get().items].slice(0, 200) })
    const backend = await getBackend()
    await backend.db.activity.append(full)
  },
}))
