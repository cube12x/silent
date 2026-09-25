import { create } from "zustand"
import type { DetectedProvider, InstallMethod, ProviderId, ProviderModel, RuntimeEvent, TerminalLine } from "@/domain"
import { PROVIDER_IDS, modelRef } from "@/domain"
import { PROVIDERS } from "@/providers/registry"
import { getBackend } from "@/services"
import { useSettingsStore } from "./settings"

export interface ProviderState {
  id: ProviderId
  detected?: DetectedProvider
  installed: boolean
  enabled: boolean
  models: ProviderModel[]
  installing: boolean
  installLog: TerminalLine[]
}

interface ProvidersState {
  providers: Record<ProviderId, ProviderState>
  detecting: boolean
  lastDetectedAt?: number
  /** Set when the host failed to detect CLIs; shown in Settings. */
  lastError?: string
  load(): Promise<void>
  detect(): Promise<void>
  setEnabled(id: ProviderId, enabled: boolean): Promise<void>
  install(id: ProviderId, method: InstallMethod): Promise<void>
  login(id: ProviderId): Promise<void>
  addCustomModel(id: ProviderId, modelId: string, label?: string): Promise<void>
  removeCustomModel(id: ProviderId, modelId: string): Promise<void>
  /** ModelRefs a CLI rejected at runtime (e.g. not included in the account's plan). Cleared by a re-scan. */
  unavailable: string[]
  markUnavailable(ref: string, reason: string): void
  /** Models of installed + enabled CLIs (catalog + static + custom), deduplicated, minus unavailable ones. */
  availableModels(): ProviderModel[]
  modelByRef(ref: string): ProviderModel | undefined
}

function emptyState(id: ProviderId): ProviderState {
  return { id, installed: false, enabled: true, models: [], installing: false, installLog: [] }
}

function mergeModels(id: ProviderId, fromCli: ProviderModel[]): ProviderModel[] {
  const custom = useSettingsStore.getState().settings.customModels[id] ?? []
  const info = PROVIDERS[id]
  const out = new Map<string, ProviderModel>()
  for (const m of fromCli) out.set(m.id, m)
  for (const s of info.staticModels) if (!out.has(s.id)) out.set(s.id, { ...s, providerId: id, source: "alias" })
  for (const c of custom) out.set(c.id, { id: c.id, providerId: id, displayName: c.label || c.id, source: "custom", tier: "strong" })
  const list = Array.from(out.values())
  if (!list.some((m) => m.isDefault) && list.length) list[0] = { ...list[0], isDefault: true }
  return list
}

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: Object.fromEntries(PROVIDER_IDS.map((id) => [id, emptyState(id)])) as Record<ProviderId, ProviderState>,
  detecting: false,
  unavailable: [],
  markUnavailable(ref, reason) {
    if (get().unavailable.includes(ref)) return
    console.warn(`model unavailable: ${ref} — ${reason}`)
    set({ unavailable: [...get().unavailable, ref] })
  },
  async load() {
    const enabled = useSettingsStore.getState().settings.enabledProviders
    // Retired CLIs (Gemini CLI for consumer accounts) stay off unless the user switched them on explicitly.
    set({ providers: Object.fromEntries(PROVIDER_IDS.map((id) => [id, { ...get().providers[id], enabled: enabled[id] ?? !PROVIDERS[id].retired }])) as Record<ProviderId, ProviderState> })
    await get().detect()
  },
  async detect() {
    set({ detecting: true, lastError: undefined })
    try {
      const backend = await getBackend()
      const detected = await backend.providersDetect()
      const next = { ...get().providers }
      await Promise.all(
        PROVIDER_IDS.map(async (id) => {
          const d = detected.find((x) => x.id === id)
          const installed = Boolean(d?.installed)
          let models: ProviderModel[] = []
          if (installed) {
            try {
              models = await backend.providerModels(id)
            } catch (err) {
              console.warn(`provider_models(${id}) failed`, err)
            }
          }
          next[id] = { ...next[id], detected: d, installed, models: mergeModels(id, models) }
        }),
      )
      set({ providers: next, lastDetectedAt: Date.now(), unavailable: [] })
      // First real detection: pick a sensible default model if none is set.
      const settings = useSettingsStore.getState().settings
      const available = get().availableModels()
      if (available.length && !available.some((m) => modelRef(m.providerId, m.id) === settings.defaultModelRef)) {
        const prefer = available.find((m) => m.isDefault) ?? available[0]
        const fallback = available.find((m) => m.providerId !== prefer.providerId) ?? available.find((m) => m.id !== prefer.id) ?? prefer
        await useSettingsStore.getState().update({ defaultModelRef: modelRef(prefer.providerId, prefer.id), fallbackModelRef: modelRef(fallback.providerId, fallback.id) })
      }
    } catch (err) {
      console.error("provider detection failed", err)
      set({ lastError: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ detecting: false })
    }
  },
  async setEnabled(id, enabled) {
    set({ providers: { ...get().providers, [id]: { ...get().providers[id], enabled } } })
    await useSettingsStore.getState().update((s) => ({ ...s, enabledProviders: { ...s.enabledProviders, [id]: enabled } }))
  },
  async install(id, method) {
    const backend = await getBackend()
    const push = (line: TerminalLine) => set({ providers: { ...get().providers, [id]: { ...get().providers[id], installLog: [...get().providers[id].installLog.slice(-800), line] } } })
    set({ providers: { ...get().providers, [id]: { ...get().providers[id], installing: true, installLog: [] } } })
    const cmd = method === "npm" ? PROVIDERS[id].installNpm : PROVIDERS[id].installScript
    push({ ts: Date.now(), stream: "system", text: `$ ${cmd ?? ""}` })
    await new Promise<void>((resolve) => {
      const onEvent = (e: RuntimeEvent) => {
        if (e.type === "stdout") push({ ts: Date.now(), stream: "stdout", text: e.data.line })
        else if (e.type === "stderr") push({ ts: Date.now(), stream: "stderr", text: e.data.line })
        else if (e.type === "agentMessage") push({ ts: Date.now(), stream: "stdout", text: e.data.text })
        else if (e.type === "failed") push({ ts: Date.now(), stream: "stderr", text: e.data.message })
        else if (e.type === "exited") {
          push({ ts: Date.now(), stream: "system", text: `exit ${e.data.code ?? "?"}` })
          resolve()
        }
      }
      backend.providerInstall(id, method, onEvent).catch((err: unknown) => {
        push({ ts: Date.now(), stream: "stderr", text: err instanceof Error ? err.message : String(err) })
        resolve()
      })
    })
    set({ providers: { ...get().providers, [id]: { ...get().providers[id], installing: false } } })
    await get().detect()
    const after = get().providers[id]
    if (after.installed) push({ ts: Date.now(), stream: "system", text: `✓ ${after.detected?.path ?? id} ${after.detected?.version ?? ""}` })
  },
  async login(id) {
    const backend = await getBackend()
    await backend.providerLogin(id)
  },
  async addCustomModel(id, modelId, label) {
    const trimmed = modelId.trim()
    if (!trimmed) return
    await useSettingsStore.getState().update((s) => ({ ...s, customModels: { ...s.customModels, [id]: [...(s.customModels[id] ?? []).filter((m) => m.id !== trimmed), { id: trimmed, label: label?.trim() || trimmed }] } }))
    set({ providers: { ...get().providers, [id]: { ...get().providers[id], models: mergeModels(id, get().providers[id].models.filter((m) => m.source !== "custom")) } } })
  },
  async removeCustomModel(id, modelId) {
    await useSettingsStore.getState().update((s) => ({ ...s, customModels: { ...s.customModels, [id]: (s.customModels[id] ?? []).filter((m) => m.id !== modelId) } }))
    set({ providers: { ...get().providers, [id]: { ...get().providers[id], models: mergeModels(id, get().providers[id].models.filter((m) => m.source !== "custom")) } } })
  },
  availableModels() {
    const blocked = new Set(get().unavailable)
    return PROVIDER_IDS.flatMap((id) => {
      const p = get().providers[id]
      return p.installed && p.enabled ? p.models.filter((m) => !blocked.has(modelRef(m.providerId, m.id))) : []
    })
  },
  modelByRef(ref) {
    const i = ref.indexOf(":")
    if (i < 0) return undefined
    const p = get().providers[ref.slice(0, i) as ProviderId]
    return p?.models.find((m) => m.id === ref.slice(i + 1))
  },
}))

/** Pure helper so components can memoise on the providers map only. */
export function selectAvailableModels(providers: Record<ProviderId, ProviderState>, unavailable: string[] = []): ProviderModel[] {
  const blocked = new Set(unavailable)
  return PROVIDER_IDS.flatMap((id) => (providers[id].installed && providers[id].enabled ? providers[id].models.filter((m) => !blocked.has(modelRef(m.providerId, m.id))) : []))
}
