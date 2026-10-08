import type { Blueprint, Chat, CliRunRequest, DetectedProvider, Message, MemoryEntry, MindModel, ProviderId, ProviderModel, RepoAgent, RepoInfo, RuntimeEvent, SilentCodeRun, TerminalLine } from "@/domain"
import type { AppInfo, Backend, KvStore, PrereqStatus, Repositories, RunHandle, HostLoad } from "./backend"

/** In-memory backend for unit tests. Not a product feature: CLI runs resolve with a scripted transcript. */
/** A 1×2×1 box as GLB (trimesh export) so the 3D viewer can be exercised in the preview. */
const PREVIEW_GLB = "Z2xURgIAAACgAwAAlAIAAEpTT057InNjZW5lIjowLCJzY2VuZXMiOlt7Im5vZGVzIjpbMF19XSwiYXNzZXQiOnsidmVyc2lvbiI6IjIuMCIsImdlbmVyYXRvciI6Imh0dHBzOi8vZ2l0aHViLmNvbS9taWtlZGgvdHJpbWVzaCJ9LCJhY2Nlc3NvcnMiOlt7ImNvbXBvbmVudFR5cGUiOjUxMjUsInR5cGUiOiJTQ0FMQVIiLCJidWZmZXJWaWV3IjowLCJjb3VudCI6MzYsIm1heCI6WzddLCJtaW4iOlswXX0seyJjb21wb25lbnRUeXBlIjo1MTI2LCJ0eXBlIjoiVkVDMyIsImJ5dGVPZmZzZXQiOjAsImJ1ZmZlclZpZXciOjEsImNvdW50Ijo4LCJtYXgiOlswLjUsMS4wLDAuNV0sIm1pbiI6Wy0wLjUsLTEuMCwtMC41XX1dLCJtZXNoZXMiOlt7Im5hbWUiOiJnZW9tZXRyeV8wIiwiZXh0cmFzIjp7InNoYXBlIjoiYm94IiwiZXh0ZW50cyI6WzEuMCwyLjAsMS4wXX0sInByaW1pdGl2ZXMiOlt7ImF0dHJpYnV0ZXMiOnsiUE9TSVRJT04iOjF9LCJpbmRpY2VzIjowLCJtb2RlIjo0fV19XSwibm9kZXMiOlt7Im5hbWUiOiJnZW9tZXRyeV8wIiwibWVzaCI6MH1dLCJidWZmZXJzIjpbeyJieXRlTGVuZ3RoIjoyNDB9XSwiYnVmZmVyVmlld3MiOlt7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MCwiYnl0ZUxlbmd0aCI6MTQ0fSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MTQ0LCJieXRlTGVuZ3RoIjo5Nn1dfSAgICDwAAAAQklOAAEAAAADAAAAAAAAAAQAAAABAAAAAAAAAAAAAAADAAAAAgAAAAIAAAAEAAAAAAAAAAEAAAAHAAAAAwAAAAUAAAABAAAABAAAAAUAAAAHAAAAAQAAAAMAAAAHAAAAAgAAAAYAAAAEAAAAAgAAAAIAAAAHAAAABgAAAAYAAAAFAAAABAAAAAcAAAAFAAAABgAAAAAAAL8AAIC/AAAAvwAAAL8AAIC/AAAAPwAAAL8AAIA/AAAAvwAAAL8AAIA/AAAAPwAAAD8AAIC/AAAAvwAAAD8AAIC/AAAAPwAAAD8AAIA/AAAAvwAAAD8AAIA/AAAAPw=="
const PREVIEW_TILES = { frameW: 16, frameH: 16, columns: 2, frames: [{ name: "grass", x: 0, y: 0, w: 16, h: 16 }, { name: "dirt", x: 16, y: 0, w: 16, h: 16 }] }
/** Frames of the preview's canned atlases (hero.json / tiles.json): enough for an animated preview. */
const PREVIEW_ATLAS = { frameW: 32, frameH: 32, columns: 2, frames: [{ name: "murkcap_idle_00", x: 0, y: 0, w: 32, h: 32 }, { name: "murkcap_idle_01", x: 32, y: 0, w: 32, h: 32 }, { name: "murkcap_run_00", x: 0, y: 32, w: 32, h: 32 }, { name: "murkcap_run_01", x: 32, y: 32, w: 32, h: 32 }] }

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
  private mindModels = new Map<string, MindModel>()

  load: HostLoad = { load1: 0, cpus: 8, swapUsedPct: 0 }
  async hostLoad(): Promise<HostLoad> {
    return this.load
  }
  statusJson = ""
  async statusWrite(json: string): Promise<void> {
    this.statusJson = json
  }
  pendingUpdate: string | null = null
  applied: string[] = []
  async updatePending(): Promise<string | null> {
    return this.pendingUpdate
  }
  async updateApply(path: string): Promise<void> {
    this.applied.push(path)
    this.pendingUpdate = null
  }
  swept: string[] = []
  async projectSweep(folder: string): Promise<number> {
    this.swept.push(folder)
    return 0
  }
  orphansCancelled = 0
  async cliCancelOrphans(): Promise<number> {
    this.orphansCancelled += 1
    return 0
  }
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
  prereqs: PrereqStatus[] = []
  async prereqsCheck(): Promise<PrereqStatus[]> {
    return this.prereqs
  }
  async setupFix(): Promise<RunHandle> {
    return { cancel: async () => {} }
  }
  async cliLauncherStatus() {
    return { installed: false, path: "/opt/homebrew/bin/silent", dir: "/opt/homebrew/bin", appPath: "/Applications/Silent.app", onPath: true }
  }
  async installCliLauncher() {
    return { installed: true, path: "/opt/homebrew/bin/silent", dir: "/opt/homebrew/bin", appPath: "/Applications/Silent.app", onPath: true }
  }
  async repoInspect(path: string): Promise<RepoInfo> {
    return { path, exists: true, isGitRepo: true, name: path.split("/").pop() ?? path, branch: "main", fileCount: 1, languages: [] }
  }
  async pickDirectory() {
    // Dev preview: a canned folder so Build boxes (and the Dosyalar tab) can be exercised without a dialog.
    return this.preview ? "/Users/demo/CubeCode/demo-game" : null
  }
  async pickFiles() {
    return this.preview ? ["/Users/demo/Downloads/hero-sheet.png"] : []
  }
  projectFiles: Record<string, string> = {}
  async writeProjectFile(_root: string, rel: string, content: string) {
    this.projectFiles[rel] = content
  }
  blueprintsMem: Blueprint[] = []
  async blueprintBuildDir(blueprint: string, build: string) {
    return `/tmp/blueprints/${blueprint}/${build}`
  }
  async blueprintBuildStats() {
    return { fileCount: 0, images: [] as string[], newestMs: 0 }
  }
  async blueprintBuildImport(_folder: string, paths: string[]) {
    return paths.length
  }
  async blueprintWriteTool(folder: string, name: string) {
    return `${folder}/.silent/tools/${name}`
  }
  async blueprintBuildSend() {
    return 0
  }
  async autostartTake() {
    return null
  }
  async changedFiles() {
    return [] as string[]
  }
  async syncReferences(repoPath: string, refs: Array<{ name: string; url: string }>) {
    return refs.map((r) => ({ name: r.name, path: `${repoPath}/.silent/refs/${r.name}`, ok: true }))
  }
  async confirm(message: string) {
    return typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(message) : true
  }
  checks: Array<{ cwd: string; command: string; token?: string }> = []
  checkCancels: string[] = []
  checkResult = { ok: true, exitCode: 0, tail: "", elapsedMs: 1 }
  async runCheck(cwd: string, command: string, _timeoutSecs?: number, _maxLines?: number, token?: string) {
    this.checks.push({ cwd, command, token })
    return this.checkResult
  }
  async checkCancel(token: string) {
    this.checkCancels.push(token)
  }
  importedNames = new Set<string>()
  /** Returns basenames; a basename seen before in this session comes back as `<stem>-2.<ext>` (the real backend renames duplicates). */
  async blueprintBuildImportPaths(_folder: string, paths: string[]) {
    return paths.map((p) => {
      const base = p.split("/").pop() ?? p
      if (!this.importedNames.has(base)) {
        this.importedNames.add(base)
        return base
      }
      const dot = base.lastIndexOf(".")
      return dot > 0 ? `${base.slice(0, dot)}-2${base.slice(dot)}` : `${base}-2`
    })
  }
  snapshots: Array<{ cwd: string; ref: string }> = []
  restored: Array<{ cwd: string; ref: string }> = []
  async gitSnapshot(cwd: string) {
    const ref = `refs/silent/snapshots/${this.snapshots.length + 1}`
    this.snapshots.push({ cwd, ref })
    return ref
  }
  async gitRestore(cwd: string, ref: string) {
    this.restored.push({ cwd, ref })
  }
  digest = ""
  async repoDigest() {
    return this.digest
  }
  async readProjectFile(_root: string, rel: string) {
    if (this.projectFiles[rel] !== undefined) return this.projectFiles[rel]
    // Dev preview: the atlas JSON of the canned pixel-art project (see listProjectFiles).
    if (this.preview && rel.endsWith(".json")) return JSON.stringify(rel.includes("tiles") ? PREVIEW_TILES : PREVIEW_ATLAS)
    return null
  }
  async listProjectFiles() {
    // A tiny pixel-art project so the Dosyalar tab has something to show in the preview.
    const rels = ["assets/converted/hero.png", "assets/converted/hero.json", "assets/converted/tiles.png", "assets/converted/tiles.json", "assets/sprites/photo.jpg", "assets/uydurma/sfx__jump.wav", "assets/models/crate.glb", "src/game/player/index.ts", "src/game/world/index.ts", "src/render/index.ts", "README.md"]
    return rels.map((rel, i) => ({ rel, size: 100 + i, mtimeMs: 1_700_000_000_000 + i }))
  }
  async readProjectBlob(_root: string, rel: string) {
    if (rel.endsWith(".json")) return { mime: "application/json", base64: btoa(JSON.stringify(rel.includes("tiles") ? PREVIEW_TILES : PREVIEW_ATLAS)) }
    if (rel.endsWith(".glb")) return { mime: "model/gltf-binary", base64: PREVIEW_GLB }
    if (rel.endsWith(".png") || rel.endsWith(".jpg")) return { mime: rel.endsWith(".png") ? "image/png" : "image/jpeg", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" }
    return null
  }
  async createProjectDir(name: string) {
    return `/Users/demo/CubeCode/${name}`
  }
  async openExternal() {}
  opened: string[] = []
  async openPath(path: string) {
    this.opened.push(path)
  }
  openedUrls: string[] = []
  async openUrl(url: string) {
    this.openedUrls.push(url)
  }
  async cliStart(request: CliRunRequest, onEvent: (event: RuntimeEvent) => void): Promise<RunHandle> {
    if (this.preview && request.runId.startsWith("plan:")) {
      // Dev preview only: a canned planner reply so the Task→Plan→Start UI can be reviewed without a CLI.
      const plan = { summary: "Preview plan", subtasks: [{ key: "a", kind: "backend", title: "Backend API", description: "Implement the endpoints.", dependsOn: [], weight: 2, tier: "strong", effort: "medium", rationale: "core work" }, { key: "b", kind: "frontend", title: "UI", description: "Build the screens.", dependsOn: ["a"], weight: 2, tier: "strong", effort: "medium", rationale: "depends on API" }, { key: "c", kind: "tests", title: "Tests", description: "Cover the API.", dependsOn: ["a"], weight: 1, tier: "fast", effort: "low", rationale: "mechanical" }], questions: [{ id: "q1", question: "Which content sources may be used?", why: "Licensing matters", options: ["Licensed only", "Any source"] }], assumptions: ["pnpm workspace"], excluded: ["algorithm"] }
      queueMicrotask(() => {
        onEvent({ type: "agentMessage", data: { text: JSON.stringify(plan) } })
        onEvent({ type: "exited", data: { code: 0 } })
      })
      return { cancel: async () => {} }
    }
    if (this.preview && request.runId.startsWith("mind:")) {
      // Dev preview of MindMirror: Bilinç hands an EYLEM block over, Eylem reports, the memory call remembers one fact.
      const stage = request.runId.split(":")[1]
      const text =
        stage === "bilinc"
          ? "DÜŞÜNCE:\n- Kullanıcı vizyondaki filmleri istiyor; sayfayı ben açamam.\n- Eylem'e adres ve dönüş listesi veririm.\n\nÖnizleme: Atarus sinemasında üç film olabilir.\n\nEYLEM:\n1. https://atarus.example/sinema adresini aç\n2. vizyondaki filmleri listele\nDÖNÜŞ: film adları ve seanslar"
          : stage === "eylem"
            ? "# SONUÇ\nÖnizleme: 3 film bulundu — A (19:00), B (20:30), C (22:00)."
            : stage === "mem"
              ? "# HATIRLA\n- Kullanıcı Atarus sinemasını takip ediyor"
              : "önizleme terminal çıktısı: a.txt b.txt"
      queueMicrotask(() => {
        onEvent({ type: "sessionStarted", data: { sessionId: `preview-${stage}-${Date.now().toString(36)}` } } as RuntimeEvent)
        onEvent({ type: "reasoningStatus", data: { status: `preview ${stage}: reading the workspace` } } as RuntimeEvent)
        if (stage === "eylem") {
          onEvent({ type: "commandStarted", data: { command: "curl -s https://atarus.example/sinema" } } as RuntimeEvent)
          onEvent({ type: "commandCompleted", data: { command: "curl -s https://atarus.example/sinema", exitCode: 0, outputTail: "<title>Atarus Sinema</title>" } } as RuntimeEvent)
          onEvent({ type: "fileChanged", data: { path: "NOTLAR.md", kind: "add" } } as RuntimeEvent)
        }
        onEvent({ type: "textDelta", data: { text: text.slice(0, 12) } } as RuntimeEvent)
        onEvent({ type: "agentMessage", data: { text } } as RuntimeEvent)
        onEvent({ type: "usage", data: { inputTokens: 120, outputTokens: 40 } } as RuntimeEvent)
        onEvent({ type: "exited", data: { code: 0 } } as RuntimeEvent)
      })
      return { cancel: async () => {} }
    }
    if (this.preview) {
      // Dev preview: a short canned session so every Blueprint box (single AI, queue, verify, wizard, naming) can be clicked through without a CLI.
      queueMicrotask(() => {
        onEvent({ type: "sessionStarted", data: { sessionId: `preview-${Date.now().toString(36)}` } } as RuntimeEvent)
        onEvent({ type: "agentMessage", data: { text: "Preview session: nothing is executed in the browser.\n\n# MODEL_REQUESTS\n[{\"name\":\"hero\",\"kind\":\"sprite-sheet\",\"subject\":\"the hero\",\"animations\":[{\"name\":\"idle\",\"frames\":2},{\"name\":\"walk\",\"frames\":2}],\"frameSize\":\"32x32\",\"view\":\"side\"}]\n\n# FINDINGS\n- preview only\n\n# VERIFY\n- OK\n\nNAME: Preview\nSUMMARY: Preview build.\n\nSILENT_DEVIATIONS: none" } } as RuntimeEvent)
        onEvent({ type: "exited", data: { code: 0 } } as RuntimeEvent)
      })
      return { cancel: async () => {} }
    }
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
      { id: "claude", binary: "claude", installed: true, version: "2.1.280", path: "/Users/demo/.local/bin/claude" },
      { id: "kimi", binary: "kimi", installed: true, version: "0.34.0", path: "/Users/demo/.kimi-code/bin/kimi" },
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
    blueprints: {
      list: async () => this.blueprintsMem,
      upsert: async (bp) => {
        this.blueprintsMem = [bp, ...this.blueprintsMem.filter((b) => b.id !== bp.id)]
      },
      delete: async (id) => {
        this.blueprintsMem = this.blueprintsMem.filter((b) => b.id !== id)
      },
    },
    chats: { list: async () => Array.from(this.chats.values()), upsert: async (c) => void this.chats.set(c.id, c), delete: async (id) => void this.chats.delete(id) },
    messages: {
      listByChat: async (chatId) => Array.from(this.messages.values()).filter((m) => m.chatId === chatId),
      upsert: async (m) => void this.messages.set(m.id, m),
      deleteByChat: async (chatId) => {
        for (const [id, m] of this.messages) if (m.chatId === chatId) this.messages.delete(id)
      },
    },
    mindModels: { list: async () => Array.from(this.mindModels.values()), upsert: async (m) => void this.mindModels.set(m.id, m), delete: async (id) => void this.mindModels.delete(id) },
    agents: { list: async () => Array.from(this.agents.values()), upsert: async (a) => void this.agents.set(a.id, a), delete: async (id) => void this.agents.delete(id) },
    runs: { list: async () => Array.from(this.runs.values()), upsert: async (r) => void this.runs.set(r.id, r), delete: async (id) => void this.runs.delete(id) },
    terminal: { listBySubtask: async (id) => this.terminal.get(id) ?? [], append: async (_r, id, lines, keep = 2000) => void this.terminal.set(id, [...(this.terminal.get(id) ?? []), ...lines].slice(-keep)) },
    memory: { list: async () => Array.from(this.memory.values()), upsert: async (e) => void this.memory.set(e.id, e), delete: async (id) => void this.memory.delete(id) },
  }
}
