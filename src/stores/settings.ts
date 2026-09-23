import { create } from "zustand"
import type { Settings } from "@/domain"
import { DEFAULT_SETTINGS } from "@/domain"
import { getBackend } from "@/services"

interface SettingsState {
  settings: Settings
  loaded: boolean
  load(): Promise<void>
  update(patch: Partial<Settings> | ((s: Settings) => Settings)): Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    const backend = await getBackend()
    const stored = await backend.kv.get<Partial<Settings>>("settings")
    const merged: Settings = { ...DEFAULT_SETTINGS, ...stored, security: { ...DEFAULT_SETTINGS.security, ...stored?.security, allowDangerFullAccess: false } }
    set({ settings: merged, loaded: true })
    applyTheme(merged)
  },
  async update(patch) {
    const next = typeof patch === "function" ? patch(get().settings) : { ...get().settings, ...patch }
    next.security.allowDangerFullAccess = false
    set({ settings: next })
    applyTheme(next)
    const backend = await getBackend()
    await backend.kv.set("settings", next)
  },
}))

function applyTheme(s: Settings) {
  if (typeof document === "undefined") return
  document.documentElement.classList.toggle("graphite", s.theme === "graphite")
  document.documentElement.classList.toggle("reduced-motion", s.reducedMotion)
}
