import { getBackend } from "@/services"
import { MOCK_ACTIVITY, MOCK_AGENTS, MOCK_CHATS, MOCK_MEMORY, MOCK_MESSAGES, MOCK_RUNS, mockTerminalLines } from "@/mocks"
import { useActivityStore } from "@/stores/activity"
import { useAgentsStore } from "@/stores/agents"
import { useChatsStore } from "@/stores/chats"
import { useMemoryStore } from "@/stores/memory"
import { useProvidersStore } from "@/stores/providers"
import { useRunsStore } from "@/stores/runs"
import { useSettingsStore } from "@/stores/settings"

const SEED_KEY = "seeded.v1"

let inflight: Promise<void> | undefined

/** Hydrate every store; on first launch seed the demo workspace so the app is never empty. Idempotent (StrictMode double-invokes effects). */
export function bootstrap(): Promise<void> {
  inflight ??= run()
  return inflight
}

async function run(): Promise<void> {
  const backend = await getBackend()
  const seeded = await backend.kv.get<boolean>(SEED_KEY)
  if (!seeded) {
    for (const a of MOCK_AGENTS) await backend.db.agents.upsert(a)
    for (const c of MOCK_CHATS) await backend.db.chats.upsert(c)
    for (const list of Object.values(MOCK_MESSAGES)) for (const m of list) await backend.db.messages.upsert(m)
    for (const r of MOCK_RUNS) {
      await backend.db.runs.upsert(r)
      for (const [subtaskId, lines] of Object.entries(mockTerminalLines(r))) await backend.db.terminal.append(r.id, subtaskId, lines)
    }
    for (const m of MOCK_MEMORY) await backend.db.memory.upsert(m)
    for (const a of MOCK_ACTIVITY) await backend.db.activity.append(a)
    await backend.kv.set(SEED_KEY, true)
  }
  await useSettingsStore.getState().load()
  await Promise.all([
    useAgentsStore.getState().load(),
    useChatsStore.getState().load(),
    useRunsStore.getState().load(),
    useMemoryStore.getState().load(),
    useActivityStore.getState().load(),
  ])
  void useProvidersStore.getState().load()
  if (backend.kind === "fake" && !useRunsStore.getState().runs.some((r) => r.status === "running")) {
    // Browser demo: keep the command center alive with a simulated run.
    const agent = useAgentsStore.getState().agents[0]
    const d = useRunsStore.getState().draft({ prompt: "Add a real-time notification system to the Reach repository with websocket fan-out and tests.", pool: ["claude-opus", "claude-sonnet", "codex", "gemini", "glm", "fable-ultracode"], executionMode: "staged", costMode: "balanced", repoAgentId: agent?.id })
    void useRunsStore.getState().start(d)
  }
}
