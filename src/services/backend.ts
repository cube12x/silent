import type { Chat, CliRunRequest, DetectedProvider, InstallMethod, Message, MemoryEntry, ProviderId, ProviderModel, RepoAgent, RepoInfo, RuntimeEvent, SilentCodeRun, TerminalLine } from "@/domain"

export interface AppInfo {
  name: string
  version: string
  platform: string
}

export interface LauncherStatus {
  installed: boolean
  path: string
  appPath: string
  onPath: boolean
}

export interface RunHandle {
  cancel(): Promise<void>
}

export interface KvStore {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
}

export interface Repositories {
  chats: { list(): Promise<Chat[]>; upsert(chat: Chat): Promise<void>; delete(id: string): Promise<void> }
  messages: { listByChat(chatId: string): Promise<Message[]>; upsert(message: Message): Promise<void> }
  agents: { list(): Promise<RepoAgent[]>; upsert(agent: RepoAgent): Promise<void>; delete(id: string): Promise<void> }
  runs: { list(): Promise<SilentCodeRun[]>; upsert(run: SilentCodeRun): Promise<void>; delete(id: string): Promise<void> }
  terminal: { listBySubtask(subtaskId: string): Promise<TerminalLine[]>; /** Batched insert; keeps at most `keep` newest lines per subtask. */ append(runId: string, subtaskId: string, lines: TerminalLine[], keep?: number): Promise<void> }
  memory: { list(): Promise<MemoryEntry[]>; upsert(entry: MemoryEntry): Promise<void>; delete(id: string): Promise<void> }
}

/**
 * The single seam between UI/engine and the host. `TauriBackend` talks to Rust; `TestBackend` is an
 * in-memory double for unit tests only (there is no demo/simulation mode in the product).
 */
export interface Backend {
  readonly kind: "tauri" | "test"
  appInfo(): Promise<AppInfo>
  providersDetect(): Promise<DetectedProvider[]>
  providerModels(providerId: ProviderId): Promise<ProviderModel[]>
  providerInstall(providerId: ProviderId, method: InstallMethod, onEvent: (event: RuntimeEvent) => void): Promise<RunHandle>
  providerLogin(providerId: ProviderId): Promise<void>
  cliLauncherStatus(): Promise<LauncherStatus>
  installCliLauncher(): Promise<LauncherStatus>
  repoInspect(path: string): Promise<RepoInfo>
  pickDirectory(): Promise<string | null>
  /** Create ~/CubeCode/<slug> (or the configured projects dir) and return its absolute path. */
  createProjectDir(name: string): Promise<string>
  openExternal(url: string): Promise<void>
  cliStart(request: CliRunRequest, onEvent: (event: RuntimeEvent) => void): Promise<RunHandle>
  kv: KvStore
  db: Repositories
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}
