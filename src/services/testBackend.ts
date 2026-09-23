import type { Chat, CliRunRequest, DetectedProvider, Message, MemoryEntry, ProviderId, ProviderModel, RepoAgent, RepoInfo, RuntimeEvent, SilentCodeRun, TerminalLine } from "@/domain"
import type { AppInfo, Backend, KvStore, Repositories, RunHandle } from "./backend"

/** In-memory backend for unit tests. Not a product feature: CLI runs resolve with a scripted transcript. */
export class TestBackend implements Backend {
  readonly kind = "test" as const
  detected: DetectedProvider[] = []
  models: Partial<Record<ProviderId, ProviderModel[]>> = {}
  /** Events replayed by cliStart; tests set this. */
  transcript: RuntimeEvent[] = [{ type: "sessionStarted", data: { sessionId: "s1" } }, { type: "agentMessage", data: { text: "OK" } }, { type: "turnCompleted", data: {} }, { type: "exited", data: { code: 0 } }]
  private kvData = new Map<string, unknown>()
  private chats = new Map<string, Chat>()
  private messages = new Map<string, Message>()
  private agents = new Map<string, RepoAgent>()
  private runs = new Map<string, SilentCodeRun>()
  private terminal = new Map<string, TerminalLine[]>()
  private memory = new Map<string, MemoryEntry>()

  async appInfo(): Promise<AppInfo> {
    return { name: "Silent", version: "test", platform: "test" }
  }
  async providersDetect() {
    return this.detected
  }
  async providerModels(providerId: ProviderId) {
    return this.models[providerId] ?? []
  }
  async providerInstall(): Promise<RunHandle> {
    return { cancel: async () => {} }
  }
  async providerLogin() {}
  async repoInspect(path: string): Promise<RepoInfo> {
    return { path, exists: true, isGitRepo: true, name: path.split("/").pop() ?? path, branch: "main", fileCount: 1, languages: [] }
  }
  async pickDirectory() {
    return null
  }
  async openExternal() {}
  async cliStart(_request: CliRunRequest, onEvent: (event: RuntimeEvent) => void): Promise<RunHandle> {
    if (this.preview) throw new Error("Browser preview: CLIs only run inside the Silent desktop app.")
    let cancelled = false
    queueMicrotask(() => {
      for (const e of this.transcript) if (!cancelled) onEvent(e)
    })
    return { cancel: async () => void (cancelled = true) }
  }

  /**
   * Browser preview (dev only, `VITE_SILENT_PREVIEW=1`): shows the real CLI catalog of this machine so
   * screens can be reviewed in a browser. Nothing is executed; cliStart refuses.
   */
  preview = false
  enablePreview(): this {
    this.preview = true
    this.detected = [
      { id: "codex", binary: "codex", installed: true, version: "codex-cli 0.153.2", path: "/opt/homebrew/bin/codex" },
      { id: "claude", binary: "claude", installed: true, version: "2.1.280", path: "/Users/cube/.local/bin/claude" },
      { id: "kimi", binary: "kimi", installed: true, version: "0.34.0", path: "/Users/cube/.kimi-code/bin/kimi" },
      { id: "grok", binary: "grok", installed: false }, { id: "gemini", binary: "gemini", installed: false }, { id: "qwen", binary: "qwen", installed: false }, { id: "opencode", binary: "opencode", installed: false }, { id: "copilot", binary: "copilot", installed: false }, { id: "cursor", binary: "agent", installed: false }, { id: "amp", binary: "amp", installed: false },
    ]
    this.models = {
      codex: [{ id: "gpt-6-astra", providerId: "codex", displayName: "GPT-6-Astra", source: "catalog", tier: "frontier", isDefault: true, meta: { efforts: "low,medium,high,xhigh,max,ultra" } }],
      claude: [{ id: "claude-fable-5-1", providerId: "claude", displayName: "claude-fable-5-1", source: "config", tier: "frontier", isDefault: true }],
      kimi: [
        { id: "kimi-code/k3-256k", providerId: "kimi", displayName: "K3-256k", source: "config", tier: "frontier", isDefault: true },
        { id: "kimi-code/k3", providerId: "kimi", displayName: "K3", source: "config", tier: "frontier" },
        { id: "kimi-code/kimi-for-coding", providerId: "kimi", displayName: "K2.7 Coding", source: "config", tier: "strong" },
        { id: "kimi-code/kimi-for-coding-highspeed", providerId: "kimi", displayName: "K2.7 Coding Highspeed", source: "config", tier: "fast" },
      ],
    }
    return this
  }
  kv: KvStore = {
    get: async <T,>(key: string) => this.kvData.get(key) as T | undefined,
    set: async (key, value) => void this.kvData.set(key, value),
  }
  db: Repositories = {
    chats: { list: async () => Array.from(this.chats.values()), upsert: async (c) => void this.chats.set(c.id, c), delete: async (id) => void this.chats.delete(id) },
    messages: { listByChat: async (chatId) => Array.from(this.messages.values()).filter((m) => m.chatId === chatId), upsert: async (m) => void this.messages.set(m.id, m) },
    agents: { list: async () => Array.from(this.agents.values()), upsert: async (a) => void this.agents.set(a.id, a), delete: async (id) => void this.agents.delete(id) },
    runs: { list: async () => Array.from(this.runs.values()), upsert: async (r) => void this.runs.set(r.id, r), delete: async (id) => void this.runs.delete(id) },
    terminal: { listBySubtask: async (id) => this.terminal.get(id) ?? [], append: async (_r, id, lines, keep = 2000) => void this.terminal.set(id, [...(this.terminal.get(id) ?? []), ...lines].slice(-keep)) },
    memory: { list: async () => Array.from(this.memory.values()), upsert: async (e) => void this.memory.set(e.id, e), delete: async (id) => void this.memory.delete(id) },
  }
}
