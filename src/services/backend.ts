import type { Chat, CodexRunRequest, DetectedProvider, Message, MemoryEntry, RepoAgent, RepoInfo, RuntimeEvent, SilentCodeRun, TerminalLine } from "@/domain"
import type { ActivityItem } from "@/mocks/activity"

export interface AppInfo {
  name: string
  version: string
  platform: string
}

export interface CodexRunHandle {
  cancel(): Promise<void>
}

/** Key-value document store for settings and UI preferences. */
export interface KvStore {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
}

export interface Repositories {
  chats: { list(): Promise<Chat[]>; upsert(chat: Chat): Promise<void>; delete(id: string): Promise<void> }
  messages: { listByChat(chatId: string): Promise<Message[]>; upsert(message: Message): Promise<void> }
  agents: { list(): Promise<RepoAgent[]>; upsert(agent: RepoAgent): Promise<void>; delete(id: string): Promise<void> }
  runs: { list(): Promise<SilentCodeRun[]>; upsert(run: SilentCodeRun): Promise<void>; delete(id: string): Promise<void> }
  terminal: { listBySubtask(subtaskId: string): Promise<TerminalLine[]>; append(runId: string, subtaskId: string, lines: TerminalLine[]): Promise<void> }
  memory: { list(): Promise<MemoryEntry[]>; upsert(entry: MemoryEntry): Promise<void>; delete(id: string): Promise<void> }
  activity: { list(limit?: number): Promise<ActivityItem[]>; append(item: ActivityItem): Promise<void> }
}

/**
 * The single seam between the UI/engine and the host. `TauriBackend` talks to Rust;
 * `FakeBackend` runs in a plain browser (`npm run dev`, tests) with in-memory data.
 */
export interface Backend {
  readonly kind: "tauri" | "fake"
  appInfo(): Promise<AppInfo>
  providersDetect(): Promise<DetectedProvider[]>
  repoInspect(path: string): Promise<RepoInfo>
  pickDirectory(): Promise<string | null>
  openExternal(url: string): Promise<void>
  codexStart(request: CodexRunRequest, onEvent: (event: RuntimeEvent) => void): Promise<CodexRunHandle>
  kv: KvStore
  db: Repositories
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}
