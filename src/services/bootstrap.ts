import { useI18nStore } from "@/i18n"
import { useAgentsStore } from "@/stores/agents"
import { useChatsStore } from "@/stores/chats"
import { useMemoryStore } from "@/stores/memory"
import { useProvidersStore } from "@/stores/providers"
import { useRunsStore } from "@/stores/runs"
import { useBlueprintsStore } from "@/stores/blueprints"
import { useSettingsStore } from "@/stores/settings"

/** Hydrate every store. No seeding: the app starts empty and real. */
let inflight: Promise<void> | undefined

export function bootstrap(): Promise<void> {
  inflight ??= run()
  return inflight
}

async function run(): Promise<void> {
  await useSettingsStore.getState().load()
  useI18nStore.getState().setLanguage(useSettingsStore.getState().settings.language)
  await Promise.all([useAgentsStore.getState().load(), useChatsStore.getState().load(), useRunsStore.getState().load(), useMemoryStore.getState().load()])
  // Blueprints after runs: their load() marks nodes of interrupted runs and credits tokens from the runs store.
  await useBlueprintsStore.getState().load()
  await useProvidersStore.getState().load()
}
