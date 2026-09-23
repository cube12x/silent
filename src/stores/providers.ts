import { create } from "zustand"
import type { DetectedProvider, Model, Provider, ProviderId } from "@/domain"
import { MODELS, PROVIDERS } from "@/engine/capabilities"
import { getBackend } from "@/services"

interface ProvidersState {
  providers: Provider[]
  detected: DetectedProvider[]
  detecting: boolean
  lastDetectedAt?: number
  detect(): Promise<void>
  setEnabled(id: ProviderId, enabled: boolean): Promise<void>
  /** Models whose provider is enabled. */
  enabledModels(): Model[]
  load(): Promise<void>
}

const KEY = "providers.enabled"

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: PROVIDERS,
  detected: [],
  detecting: false,
  async load() {
    const backend = await getBackend()
    const enabled = await backend.kv.get<Record<string, boolean>>(KEY)
    if (enabled) set({ providers: get().providers.map((p) => ({ ...p, enabled: enabled[p.id] ?? p.enabled })) })
    await get().detect()
  },
  async detect() {
    set({ detecting: true })
    try {
      const backend = await getBackend()
      const detected = await backend.providersDetect()
      set({
        detected,
        lastDetectedAt: Date.now(),
        providers: get().providers.map((p) => {
          const d = detected.find((x) => x.id === p.id)
          if (!d) return p
          if (p.executable) {
            return { ...p, status: d.installed ? (p.enabled ? "connected" : "disabled") : "not-installed", version: d.version, path: d.path }
          }
          // Installed CLI but not wired yet: still simulated, but show the real version for honesty.
          return { ...p, status: p.enabled ? "simulated" : "disabled", version: d.installed ? d.version : undefined, path: d.path }
        }),
      })
    } catch (err) {
      console.warn("provider detection failed", err)
    } finally {
      set({ detecting: false })
    }
  },
  async setEnabled(id, enabled) {
    set({
      providers: get().providers.map((p) => {
        if (p.id !== id) return p
        const installed = get().detected.find((d) => d.id === id)?.installed
        const status = !enabled ? "disabled" : p.executable ? (installed ? "connected" : "not-installed") : "simulated"
        return { ...p, enabled, status }
      }),
    })
    const backend = await getBackend()
    await backend.kv.set(KEY, Object.fromEntries(get().providers.map((p) => [p.id, p.enabled])))
  },
  enabledModels() {
    const enabled = new Set(get().providers.filter((p) => p.enabled).map((p) => p.id))
    return MODELS.filter((m) => enabled.has(m.providerId))
  },
}))
