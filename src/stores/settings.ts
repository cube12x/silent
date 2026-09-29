import { create } from "zustand"
import type { Settings } from "@/domain"
import { DEFAULT_SETTINGS } from "@/domain"
import { getBackend } from "@/services"
import { useI18nStore } from "@/i18n"

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
    const stored = await backend.kv.get<Partial<Settings>>("settings.v2")
    const merged: Settings = { ...DEFAULT_SETTINGS, ...stored, security: { ...DEFAULT_SETTINGS.security, ...stored?.security, allowDangerFullAccess: false } }
    // First run: follow the OS language (Turkish stays Turkish, everyone else starts in English).
    if (!stored && typeof navigator !== "undefined") merged.language = navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en"
    set({ settings: merged, loaded: true })
    apply(merged)
  },
  async update(patch) {
    const next = typeof patch === "function" ? patch(get().settings) : { ...get().settings, ...patch }
    next.security.allowDangerFullAccess = false
    set({ settings: next })
    apply(next)
    const backend = await getBackend()
    await backend.kv.set("settings.v2", next)
  },
}))

function apply(s: Settings) {
  useI18nStore.getState().setLanguage(s.language)
  if (typeof document !== "undefined") document.documentElement.classList.toggle("reduced-motion", s.reducedMotion)
}
