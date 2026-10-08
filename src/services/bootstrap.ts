import { useI18nStore } from "@/i18n"
import { useAgentsStore } from "@/stores/agents"
import { useChatsStore } from "@/stores/chats"
import { useMemoryStore } from "@/stores/memory"
import { useProvidersStore } from "@/stores/providers"
import { useRunsStore } from "@/stores/runs"
import { useBlueprintsStore } from "@/stores/blueprints"
import { useMindStore } from "@/stores/mind"
import { useSettingsStore } from "@/stores/settings"
import { getBackend } from "@/services"
import { initPlatform } from "@/lib/platform"

/** Hydrate every store. No seeding: the app starts empty and real. */
let inflight: Promise<void> | undefined

export function bootstrap(): Promise<void> {
  inflight ??= run()
  return inflight
}

async function run(): Promise<void> {
  const backend = await getBackend()
  const info = await backend.appInfo()
  initPlatform(info.platform, info.version)
  // A reloaded webview has no handles for the CLI children the host may still be running: stop them before the
  // stores mark their nodes/runs interrupted (otherwise they keep burning quota with nobody listening).
  try {
    const n = await backend.cliCancelOrphans()
    if (n > 0) console.warn(`[boot] cancelled ${n} orphaned CLI run(s) left by the previous page`)
  } catch {
    /* preview / older host */
  }
  await useSettingsStore.getState().load()
  useI18nStore.getState().setLanguage(useSettingsStore.getState().settings.language)
  await Promise.all([useAgentsStore.getState().load(), useChatsStore.getState().load(), useRunsStore.getState().load(), useMemoryStore.getState().load()])
  // Blueprints after runs: their load() marks nodes of interrupted runs and credits tokens from the runs store.
  await useBlueprintsStore.getState().load()
  await useMindStore.getState().load()
  await useProvidersStore.getState().load()
}
