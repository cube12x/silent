import { graphJson } from "./blueprintJson"
import { Channel, invoke } from "@tauri-apps/api/core"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { open as openShell } from "@tauri-apps/plugin-shell"
import Database from "@tauri-apps/plugin-sql"
import { Store } from "@tauri-apps/plugin-store"
import type { Blueprint, Chat, CliRunRequest, DetectedProvider, InstallMethod, Message, MemoryEntry, ProviderId, ProviderModel, RepoAgent, RepoInfo, RuntimeEvent, SilentCodeRun, TerminalLine } from "@/domain"
import type { AppInfo, AutostartRequest, Backend, CheckResult, HostLoad, KvStore, LauncherStatus, PrereqStatus, Repositories, RunHandle, SetupFix, ProjectFile, ProjectBlob } from "./backend"

type Row = Record<string, unknown>

const str = (v: unknown) => (v == null ? undefined : String(v))
const num = (v: unknown) => (v == null ? undefined : Number(v))
const json = <T,>(v: unknown, fallback: T): T => {
  if (typeof v !== "string" || !v) return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

/** Real host backend: Tauri commands + SQLite (tauri-plugin-sql) + JSON store (tauri-plugin-store). */
export class TauriBackend implements Backend {
  readonly kind = "tauri" as const
  private dbPromise?: Promise<Database>
  private storePromise?: Promise<Store>

  private conn(): Promise<Database> {
    this.dbPromise ??= Database.load("sqlite:silent.db")
    return this.dbPromise
  }

  private store(): Promise<Store> {
    this.storePromise ??= Store.load("settings.json", { autoSave: 300 })
    return this.storePromise
  }

  appInfo(): Promise<AppInfo> {
    return invoke<AppInfo>("app_info")
  }
  hostLoad(): Promise<HostLoad> {
    return invoke<HostLoad>("host_load")
  }

  providersDetect(): Promise<DetectedProvider[]> {
    return invoke<DetectedProvider[]>("providers_detect")
  }

  providerModels(providerId: ProviderId): Promise<ProviderModel[]> {
    return invoke<ProviderModel[]>("provider_models", { providerId })
  }

  async providerInstall(providerId: ProviderId, method: InstallMethod, onEvent: (event: RuntimeEvent) => void): Promise<RunHandle> {
    const channel = new Channel<RuntimeEvent>()
    channel.onmessage = onEvent
    const runId = await invoke<string>("provider_install", { providerId, method, onEvent: channel })
    return { cancel: () => invoke<void>("cli_run_cancel", { runId }) }
  }

  prereqsCheck(): Promise<PrereqStatus[]> {
    return invoke<PrereqStatus[]>("prereqs_check")
  }
  async setupFix(fix: SetupFix, onEvent: (event: RuntimeEvent) => void): Promise<RunHandle> {
    const channel = new Channel<RuntimeEvent>()
    channel.onmessage = onEvent
    const runId = await invoke<string>("setup_fix", { fix, onEvent: channel })
    return { cancel: () => invoke<void>("cli_run_cancel", { runId }) }
  }
  providerLogin(providerId: ProviderId): Promise<void> {
    return invoke<void>("provider_login", { providerId })
  }

  cliLauncherStatus(): Promise<LauncherStatus> {
    return invoke<LauncherStatus>("cli_launcher_status")
  }

  installCliLauncher(): Promise<LauncherStatus> {
    return invoke<LauncherStatus>("install_cli_launcher")
  }

  repoInspect(path: string): Promise<RepoInfo> {
    return invoke<RepoInfo>("repo_inspect", { path })
  }

  async pickDirectory(): Promise<string | null> {
    const picked = await openDialog({ directory: true, multiple: false, title: "Select repository" })
    return typeof picked === "string" ? picked : null
  }

  async confirm(message: string, title?: string): Promise<boolean> {
    const { ask } = await import("@tauri-apps/plugin-dialog")
    return ask(message, { title: title ?? "Silent", kind: "warning" })
  }

  syncReferences(repoPath: string, refs: Array<{ name: string; url: string }>) {
    return invoke<Array<{ name: string; path: string; ok: boolean; error?: string }>>("refs_sync", { repoPath, refs })
  }

  blueprintBuildDir(blueprint: string, build: string, base?: string) {
    return invoke<string>("blueprint_build_dir", { blueprint, build, base: base ?? null })
  }
  blueprintBuildStats(folder: string) {
    return invoke<{ fileCount: number; images: string[]; newestMs: number }>("blueprint_build_stats", { folder })
  }
  blueprintBuildImport(folder: string, paths: string[], sub?: string, skipExisting?: boolean) {
    return invoke<number>("blueprint_build_import", { folder, paths, sub: sub ?? null, skipExisting: skipExisting ?? false })
  }
  blueprintWriteTool(folder: string, name: string, content: string) {
    return invoke<string>("blueprint_write_tool", { folder, name, content })
  }
  blueprintBuildSend(from: string, to: string, sub?: string) {
    return invoke<number>("blueprint_build_send", { from, to, sub: sub ?? null })
  }

  autostartTake() {
    return invoke<AutostartRequest | null>("autostart_take")
  }

  changedFiles(root: string, sinceMs: number): Promise<string[]> {
    return invoke<string[]>("repo_changed_files", { root, sinceMs: Math.floor(sinceMs) })
  }

  runCheck(cwd: string, command: string, timeoutSecs = 900, maxLines = 40): Promise<CheckResult> {
    return invoke<CheckResult>("project_run_check", { cwd, command, timeoutSecs, maxLines })
  }
  gitSnapshot(cwd: string): Promise<string> {
    return invoke<string>("git_snapshot", { cwd })
  }
  gitRestore(cwd: string, ref: string): Promise<void> {
    return invoke<void>("git_restore", { cwd, git_ref: ref })
  }

  repoDigest(root: string, maxBytes = 12 * 1024): Promise<string> {
    return invoke<string>("repo_digest", { root, maxBytes })
  }

  readProjectFile(root: string, rel: string, maxBytes = 65536): Promise<string | null> {
    return invoke<string | null>("read_project_file", { root, rel, maxBytes })
  }

  listProjectFiles(root: string, maxFiles = 5000): Promise<ProjectFile[]> {
    return invoke<ProjectFile[]>("list_project_files", { root, maxFiles })
  }

  readProjectBlob(root: string, rel: string, maxBytes = 8 * 1024 * 1024): Promise<ProjectBlob | null> {
    return invoke<ProjectBlob | null>("read_project_blob", { root, rel, maxBytes })
  }

  createProjectDir(name: string, base?: string): Promise<string> {
    return invoke<string>("create_project_dir", { name, base: base ?? null })
  }

  async openExternal(url: string): Promise<void> {
    await openShell(url)
  }

  openPath(path: string): Promise<void> {
    return invoke<void>("open_path", { path })
  }

  async cliStart(request: CliRunRequest, onEvent: (event: RuntimeEvent) => void): Promise<RunHandle> {
    const channel = new Channel<RuntimeEvent>()
    channel.onmessage = onEvent
    await invoke<string>("cli_run_start", { request, onEvent: channel })
    return { cancel: () => invoke<void>("cli_run_cancel", { runId: request.runId }) }
  }

  kv: KvStore = {
    get: async <T,>(key: string) => (await this.store()).get<T>(key),
    set: async (key, value) => {
      const s = await this.store()
      await s.set(key, value)
    },
  }

  db: Repositories = {
    blueprints: {
      list: async () => {
        const rows = await (await this.conn()).select<Row[]>("SELECT * FROM blueprints ORDER BY updated_at DESC")
        return rows.map((r): Blueprint => ({ id: String(r.id), name: String(r.name), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), ...(json<Partial<Blueprint>>(r.graph_json, {}) ?? {}), nodes: json<Blueprint>(r.graph_json, { nodes: [] } as unknown as Blueprint)?.nodes ?? [], edges: json<Blueprint>(r.graph_json, { edges: [] } as unknown as Blueprint)?.edges ?? [] }))
      },
      upsert: async (bp) => {
        await (await this.conn()).execute(
          `INSERT INTO blueprints (id, name, graph_json, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT(id) DO UPDATE SET name=$2, graph_json=$3, updated_at=$5`,
          [bp.id, bp.name, graphJson(bp), bp.createdAt, bp.updatedAt],
        )
      },
      delete: async (id) => {
        await (await this.conn()).execute("DELETE FROM blueprints WHERE id = $1", [id])
      },
    },
    chats: {
      list: async () => {
        const rows = await (await this.conn()).select<Row[]>("SELECT * FROM chats ORDER BY updated_at DESC")
        return rows.map(
          (r): Chat => ({
            id: String(r.id),
            title: String(r.title),
            kind: r.kind as Chat["kind"],
            providerId: (str(r.provider_id) ?? "codex") as Chat["providerId"],
            modelId: String(r.model_id),
            repoAgentId: str(r.repo_agent_id),
            repoPath: str(r.repo_path),
            gatewayPrompt: str(r.gateway),
            gatewayProfile: json(r.gateway_profile_json, undefined),
            sessionId: str(r.session_id) ?? str(r.codex_thread_id),
            runId: str(r.run_id),
            pinned: Boolean(num(r.pinned)),
            createdAt: Number(r.created_at),
            updatedAt: Number(r.updated_at),
          }),
        )
      },
      upsert: async (c) => {
        await (await this.conn()).execute(
          `INSERT INTO chats (id, title, kind, provider_id, model_id, repo_agent_id, repo_path, gateway, gateway_profile_json, session_id, pinned, created_at, updated_at, run_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT(id) DO UPDATE SET title=$2, kind=$3, provider_id=$4, model_id=$5, repo_agent_id=$6, repo_path=$7, gateway=$8, gateway_profile_json=$9, session_id=$10, pinned=$11, updated_at=$13, run_id=$14`,
          [c.id, c.title, c.kind, c.providerId, c.modelId, c.repoAgentId ?? null, c.repoPath ?? null, c.gatewayPrompt ?? null, JSON.stringify(c.gatewayProfile ?? null), c.sessionId ?? null, c.pinned ? 1 : 0, c.createdAt, c.updatedAt, c.runId ?? null],
        )
      },
      delete: async (id) => {
        const db = await this.conn()
        await db.execute("DELETE FROM messages WHERE chat_id = $1", [id])
        await db.execute("DELETE FROM chats WHERE id = $1", [id])
      },
    },
    messages: {
      listByChat: async (chatId) => {
        const rows = await (await this.conn()).select<Row[]>("SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC", [chatId])
        return rows.map(
          (r): Message => ({
            id: String(r.id),
            chatId: String(r.chat_id),
            role: r.role as Message["role"],
            content: String(r.content),
            blocks: json(r.blocks_json, []),
            usage: json(r.usage_json, undefined),
            costUsd: num(r.cost_usd),
            providerId: str(r.provider_id) as Message["providerId"],
            modelId: str(r.model_id),
            error: str(r.error),
            createdAt: Number(r.created_at),
          }),
        )
      },
      upsert: async (m) => {
        await (await this.conn()).execute(
          `INSERT INTO messages (id, chat_id, role, content, blocks_json, usage_json, model_id, provider_id, cost_usd, error, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT(id) DO UPDATE SET content=$4, blocks_json=$5, usage_json=$6, model_id=$7, provider_id=$8, cost_usd=$9, error=$10`,
          [m.id, m.chatId, m.role, m.content, JSON.stringify(m.blocks), m.usage ? JSON.stringify(m.usage) : null, m.modelId ?? null, m.providerId ?? null, m.costUsd ?? null, m.error ?? null, m.createdAt],
        )
      },
    },
    agents: {
      list: async () => {
        const rows = await (await this.conn()).select<Row[]>("SELECT * FROM repo_agents ORDER BY updated_at DESC")
        return rows.map(
          (r): RepoAgent => ({
            id: String(r.id),
            name: String(r.name),
            repoPath: String(r.repo_path),
            providerId: (str(r.provider_id) ?? "codex") as RepoAgent["providerId"],
            modelId: String(r.model_id ?? ""),
            fallbackModelRefs: json(r.fallback_model_refs_json, []),
            gatewayPrompt: String(r.gateway_prompt ?? ""),
            gatewayProfile: json(r.gateway_profile_json, {} as RepoAgent["gatewayProfile"]),
            permissions: json(r.permissions_json, {} as RepoAgent["permissions"]),
            toolsEnabled: json(r.tools_json, []),
            memoryCount: Number(r.memory_count ?? 0),
            sourceRunId: str(r.source_run_id),
            template: Number(r.is_template ?? 0) === 1 || undefined,
            runDefaults: json(r.run_defaults_json, undefined),
            status: r.status as RepoAgent["status"],
            lastActions: json(r.last_actions_json, []),
            createdAt: Number(r.created_at),
            updatedAt: Number(r.updated_at),
          }),
        )
      },
      upsert: async (a) => {
        await (await this.conn()).execute(
          `INSERT INTO repo_agents (id, name, repo_path, primary_model_id, provider_id, model_id, fallback_model_refs_json, gateway_prompt, gateway_profile_json, permissions_json, tools_json, memory_count, status, last_actions_json, created_at, updated_at, source_run_id, run_defaults_json, is_template)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           ON CONFLICT(id) DO UPDATE SET name=$2, repo_path=$3, primary_model_id=$4, provider_id=$5, model_id=$6, fallback_model_refs_json=$7, gateway_prompt=$8, gateway_profile_json=$9, permissions_json=$10, tools_json=$11, memory_count=$12, status=$13, last_actions_json=$14, updated_at=$16, source_run_id=$17, run_defaults_json=$18, is_template=$19`,
          [a.id, a.name, a.repoPath, `${a.providerId}:${a.modelId}`, a.providerId, a.modelId, JSON.stringify(a.fallbackModelRefs), a.gatewayPrompt, JSON.stringify(a.gatewayProfile), JSON.stringify(a.permissions), JSON.stringify(a.toolsEnabled), a.memoryCount, a.status, JSON.stringify(a.lastActions), a.createdAt, a.updatedAt, a.sourceRunId ?? null, a.runDefaults ? JSON.stringify(a.runDefaults) : null, a.template ? 1 : 0],
        )
      },
      delete: async (id) => {
        await (await this.conn()).execute("DELETE FROM repo_agents WHERE id = $1", [id])
      },
    },
    runs: {
      list: async () => {
        const rows = await (await this.conn()).select<Row[]>("SELECT * FROM runs ORDER BY created_at DESC")
        return rows.map(
          (r): SilentCodeRun => ({
            id: String(r.id),
            title: String(r.title ?? r.prompt),
            prompt: String(r.prompt),
            repoAgentId: str(r.repo_agent_id),
            repoPath: str(r.repo_path),
            modelPool: json(r.model_pool_json, []),
            executionMode: r.execution_mode as SilentCodeRun["executionMode"],
            costMode: r.cost_mode as SilentCodeRun["costMode"],
            status: r.status as SilentCodeRun["status"],
            plan: json(r.plan_json, []),
            routing: json(r.routing_json, []),
            estimate: json(r.estimate_json, { tokens: 0, seconds: 0 }),
            actual: json(r.actual_json, undefined),
            planSource: str(r.plan_source) as SilentCodeRun["planSource"],
            parentRunId: str(r.parent_run_id),
            report: json(r.report_json, undefined),
            questions: json(r.questions_json, undefined),
            ...(json<Partial<SilentCodeRun>>(r.meta_json, {}) ?? {}),
            manual: Boolean(num(r.manual)),
            startedAt: num(r.started_at),
            finishedAt: num(r.finished_at),
            createdAt: Number(r.created_at),
          }),
        )
      },
      upsert: async (run) => {
        await (await this.conn()).execute(
          `INSERT INTO runs (id, title, prompt, repo_agent_id, repo_path, model_pool_json, execution_mode, cost_mode, status, plan_json, routing_json, estimate_json, actual_json, started_at, finished_at, created_at, plan_source, parent_run_id, report_json, questions_json, meta_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           ON CONFLICT(id) DO UPDATE SET title=$2, repo_agent_id=$4, repo_path=$5, model_pool_json=$6, cost_mode=$8, status=$9, plan_json=$10, routing_json=$11, estimate_json=$12, actual_json=$13, started_at=$14, finished_at=$15, plan_source=$17, parent_run_id=$18, report_json=$19, questions_json=$20, meta_json=$21`,
          [run.id, run.title, run.prompt, run.repoAgentId ?? null, run.repoPath ?? null, JSON.stringify(run.modelPool), run.executionMode, run.costMode, run.status, JSON.stringify(run.plan), JSON.stringify(run.routing), JSON.stringify(run.estimate), run.actual ? JSON.stringify(run.actual) : null, run.startedAt ?? null, run.finishedAt ?? null, run.createdAt, run.planSource ?? null, run.parentRunId ?? null, run.report ? JSON.stringify(run.report) : null, run.questions ? JSON.stringify(run.questions) : null, JSON.stringify({ spec: run.spec, kitId: run.kitId, refs: run.refs, polish: run.polish, turbo: run.turbo, lite: run.lite, mechanical: run.mechanical, effort: run.effort })],
        )
      },
      delete: async (id) => {
        const db = await this.conn()
        await db.execute("DELETE FROM terminal_lines WHERE run_id = $1", [id])
        await db.execute("DELETE FROM runs WHERE id = $1", [id])
      },
    },
    terminal: {
      listBySubtask: async (subtaskId) => {
        const rows = await (await this.conn()).select<Row[]>("SELECT ts, stream, text FROM terminal_lines WHERE subtask_id = $1 ORDER BY id ASC", [subtaskId])
        return rows.map((r): TerminalLine => ({ ts: Number(r.ts), stream: r.stream as TerminalLine["stream"], text: String(r.text) }))
      },
      append: async (runId, subtaskId, lines, keep = 2000) => {
        if (!lines.length) return
        const db = await this.conn()
        // One multi-row INSERT per batch (SQLite limit on bound params → chunks of 180 rows).
        for (let i = 0; i < lines.length; i += 180) {
          const chunk = lines.slice(i, i + 180)
          const placeholders = chunk.map((_, j) => `($${j * 5 + 1},$${j * 5 + 2},$${j * 5 + 3},$${j * 5 + 4},$${j * 5 + 5})`).join(",")
          const params = chunk.flatMap((l) => [runId, subtaskId, l.ts, l.stream, l.text])
          await db.execute(`INSERT INTO terminal_lines (run_id, subtask_id, ts, stream, text) VALUES ${placeholders}`, params)
        }
        await db.execute("DELETE FROM terminal_lines WHERE subtask_id = $1 AND id NOT IN (SELECT id FROM terminal_lines WHERE subtask_id = $1 ORDER BY id DESC LIMIT $2)", [subtaskId, keep])
      },
    },
    memory: {
      list: async () => {
        const rows = await (await this.conn()).select<Row[]>("SELECT * FROM memory_entries ORDER BY created_at DESC")
        return rows.map(
          (r): MemoryEntry => ({
            id: String(r.id),
            layer: r.layer as MemoryEntry["layer"],
            scopeId: str(r.scope_id),
            scopeLabel: str(r.scope_label),
            tags: json(r.tags_json, []),
            title: String(r.title),
            body: String(r.body),
            source: String(r.source ?? ""),
            pinned: Boolean(num(r.pinned)),
            createdAt: Number(r.created_at),
          }),
        )
      },
      upsert: async (e) => {
        await (await this.conn()).execute(
          `INSERT INTO memory_entries (id, layer, scope_id, scope_label, tags_json, title, body, source, pinned, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT(id) DO UPDATE SET layer=$2, scope_id=$3, scope_label=$4, tags_json=$5, title=$6, body=$7, source=$8, pinned=$9`,
          [e.id, e.layer, e.scopeId ?? null, e.scopeLabel ?? null, JSON.stringify(e.tags), e.title, e.body, e.source, e.pinned ? 1 : 0, e.createdAt],
        )
      },
      delete: async (id) => {
        await (await this.conn()).execute("DELETE FROM memory_entries WHERE id = $1", [id])
      },
    },
  }
}
