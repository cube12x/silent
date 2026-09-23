import type { Chat, CodexRunRequest, DetectedProvider, Message, MemoryEntry, RepoAgent, RepoInfo, RuntimeEvent, SilentCodeRun, TerminalLine } from "@/domain"
import type { ActivityItem } from "@/mocks/activity"
import type { AppInfo, Backend, CodexRunHandle, KvStore, Repositories } from "./backend"

/**
 * In-memory backend for browser dev and tests. Codex runs are simulated with a scripted JSONL-like
 * event stream so the chat/terminal paths can be exercised without the CLI.
 */
export class FakeBackend implements Backend {
  readonly kind = "fake" as const
  private kvData = new Map<string, unknown>()
  private chats = new Map<string, Chat>()
  private messages = new Map<string, Message>()
  private agents = new Map<string, RepoAgent>()
  private runs = new Map<string, SilentCodeRun>()
  private terminal = new Map<string, TerminalLine[]>()
  private memory = new Map<string, MemoryEntry>()
  private activity: ActivityItem[] = []

  private readonly opts: { codexInstalled?: boolean; delayMs?: number }

  constructor(opts: { codexInstalled?: boolean; delayMs?: number } = {}) {
    this.opts = opts
  }

  async appInfo(): Promise<AppInfo> {
    return { name: "Silent", version: "0.1.0-browser", platform: "browser" }
  }

  async providersDetect(): Promise<DetectedProvider[]> {
    const codex = this.opts.codexInstalled ?? true
    return [
      { id: "codex", binary: "codex", installed: codex, version: codex ? "codex-cli 0.153.2" : undefined, path: codex ? "/opt/homebrew/bin/codex" : undefined },
      { id: "claude", binary: "claude", installed: true, version: "2.1.0", path: "/Users/cube/.local/bin/claude" },
      { id: "gemini", binary: "gemini", installed: false, error: "not found on PATH" },
    ]
  }

  async repoInspect(path: string): Promise<RepoInfo> {
    const name = path.split("/").filter(Boolean).pop() ?? path
    return { path, exists: true, isGitRepo: true, name, branch: "main", fileCount: 1287, languages: ["TypeScript", "Rust"] }
  }

  async pickDirectory(): Promise<string | null> {
    return "/Users/cube/CubeCode/example-repo"
  }

  async openExternal(): Promise<void> {}

  async codexStart(request: CodexRunRequest, onEvent: (event: RuntimeEvent) => void): Promise<CodexRunHandle> {
    let cancelled = false
    const delay = this.opts.delayMs ?? 120
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
    const emit = (e: RuntimeEvent) => {
      if (!cancelled) onEvent(e)
    }
    void (async () => {
      emit({ type: "threadStarted", data: { threadId: request.resumeThreadId ?? `thr_${request.runId}` } })
      emit({ type: "turnStarted", data: {} })
      await wait(delay)
      emit({ type: "reasoningStatus", data: { status: "Codex is reasoning" } })
      await wait(delay * 3)
      if (request.cwd) {
        emit({ type: "commandStarted", data: { command: `rg --files ${request.cwd} | head -50` } })
        await wait(delay * 2)
        emit({ type: "commandCompleted", data: { command: `rg --files ${request.cwd} | head -50`, exitCode: 0, outputTail: "src/index.ts\nsrc/app.ts\npackage.json" } })
      }
      const reply = request.review
        ? "Review complete. No blockers found. Two suggestions: tighten the input validation on the new handler and add a regression test for the reconnect path."
        : `Simulated Codex reply for: "${request.prompt.slice(0, 80)}"\n\nThis browser build cannot spawn the Codex CLI. Run the Tauri app to execute for real.`
      for (const word of reply.split(" ")) {
        if (cancelled) return
        emit({ type: "textDelta", data: { text: word + " " } })
        await wait(delay / 4)
      }
      emit({ type: "agentMessage", data: { text: reply } })
      emit({ type: "usage", data: { inputTokens: 1200, cachedInputTokens: 0, outputTokens: 180, totalTokens: 1380 } })
      emit({ type: "turnCompleted", data: {} })
      emit({ type: "exited", data: { code: 0 } })
    })()
    return {
      cancel: async () => {
        cancelled = true
        onEvent({ type: "exited", data: { code: null } })
      },
    }
  }

  kv: KvStore = {
    get: async <T,>(key: string) => this.kvData.get(key) as T | undefined,
    set: async (key, value) => {
      this.kvData.set(key, value)
    },
  }

  db: Repositories = {
    chats: {
      list: async () => Array.from(this.chats.values()).sort((a, b) => b.updatedAt - a.updatedAt),
      upsert: async (c) => {
        this.chats.set(c.id, c)
      },
      delete: async (id) => {
        this.chats.delete(id)
      },
    },
    messages: {
      listByChat: async (chatId) => Array.from(this.messages.values()).filter((m) => m.chatId === chatId).sort((a, b) => a.createdAt - b.createdAt),
      upsert: async (m) => {
        this.messages.set(m.id, m)
      },
    },
    agents: {
      list: async () => Array.from(this.agents.values()),
      upsert: async (a) => {
        this.agents.set(a.id, a)
      },
      delete: async (id) => {
        this.agents.delete(id)
      },
    },
    runs: {
      list: async () => Array.from(this.runs.values()).sort((a, b) => b.createdAt - a.createdAt),
      upsert: async (r) => {
        this.runs.set(r.id, r)
      },
      delete: async (id) => {
        this.runs.delete(id)
      },
    },
    terminal: {
      listBySubtask: async (id) => this.terminal.get(id) ?? [],
      append: async (_runId, subtaskId, lines) => {
        this.terminal.set(subtaskId, [...(this.terminal.get(subtaskId) ?? []), ...lines])
      },
    },
    memory: {
      list: async () => Array.from(this.memory.values()).sort((a, b) => b.createdAt - a.createdAt),
      upsert: async (e) => {
        this.memory.set(e.id, e)
      },
      delete: async (id) => {
        this.memory.delete(id)
      },
    },
    activity: {
      list: async (limit = 50) => [...this.activity].sort((a, b) => b.at - a.at).slice(0, limit),
      append: async (item) => {
        this.activity = [...this.activity.filter((a) => a.id !== item.id), item]
      },
    },
  }
}
