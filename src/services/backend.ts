import type { Blueprint, Chat, CliRunRequest, DetectedProvider, InstallMethod, Message, MemoryEntry, ProviderId, ProviderModel, RepoAgent, RepoInfo, RuntimeEvent, SilentCodeRun, TerminalLine } from "@/domain"

export interface AppInfo {
  name: string
  version: string
  platform: string
}

export interface PrereqStatus {
  id: "node" | "npm" | "git" | "python3" | "xcode-clt"
  found: boolean
  version?: string | null
  path?: string | null
  note?: string | null
}
export type SetupFix = "npm-user-prefix"

export interface LauncherStatus {
  /** Directory holding the launcher (what goes on PATH). */
  dir: string
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
  blueprints: { list(): Promise<Blueprint[]>; upsert(bp: Blueprint): Promise<void>; delete(id: string): Promise<void> }
}

/**
 * The single seam between UI/engine and the host. `TauriBackend` talks to Rust; `TestBackend` is an
 * in-memory double for unit tests only (there is no demo/simulation mode in the product).
 */
export interface AutostartRequest {
  folder: string
  prompt: string
  kit?: string
  polish?: boolean
  /** `--turbo`: lean, no polish, effort ≤ medium. */
  turbo?: boolean
  /** `--mechanical`: cheapest pool model for mechanical kinds. */
  mechanical?: boolean
  cost?: string
  /** Restrict the model pool to these refs (provider:model). */
  pool?: string[]
  /** Pin every build kind (architecture, backend, frontend, algorithm, integration) to this model. */
  prefer?: string
  /** Expert (template) agent name or id whose run defaults apply (flags given explicitly win). */
  agent?: string
  /** `silent bp "<blueprint name|id>" ["<node title|id>"]`: trigger a Blueprint node instead of a Silent Code run. */
  blueprint?: { ref: string; node?: string; answer?: string; only?: boolean; auto?: string; edit?: string; fix?: { problem: string; files: string[]; run?: boolean }; /** `silent bp deliver <bp> <box> <file>… [--for <request>]`: hand files to a Model Plus box. */ deliver?: { paths: string[]; for?: string }; /** `silent bp resume <bp> <box>`: resume the box's failed run from where it stopped. */ resume?: boolean; /** `silent bp handover <bp> <box> <task> <provider:model>`: hand one task over (Devret). */ handover?: { task: string; to: string } }
  /** `silent reload`: reload the webview page (recovers a blank/black window; running orchestrations are lost). */
  reload?: boolean
  /** `silent cancel`: stop every running blueprint box and Silent Code run (the UI's cancel buttons, from the terminal). */
  cancel?: boolean
}

export interface Backend {
  readonly kind: "tauri" | "test"
  appInfo(): Promise<AppInfo>
  /** Current host load (1-min load average, CPU count, swap %). */
  hostLoad(): Promise<HostLoad>
  /** `silent status`: mirror the app state into <data dir>/status.json (atomic). */
  statusWrite(json: string): Promise<void>
  /** `silent update`: the queued bundle path, if any. */
  updatePending(): Promise<string | null>
  /** Replace the running bundle with `path` and relaunch (only when nothing runs). */
  updateApply(path: string): Promise<void>
  /** Webview (re)start: cancel every CLI child the host still runs for the previous page; returns the count. */
  cliCancelOrphans(): Promise<number>
  /** Kill dev servers and Playwright browsers a worker left running for this project folder; returns the count. */
  projectSweep(folder: string): Promise<number>
  providersDetect(): Promise<DetectedProvider[]>
  providerModels(providerId: ProviderId): Promise<ProviderModel[]>
  providerInstall(providerId: ProviderId, method: InstallMethod, onEvent: (event: RuntimeEvent) => void): Promise<RunHandle>
  providerLogin(providerId: ProviderId): Promise<void>
  /** First-run prerequisites (node, npm, git, python3, macOS CLT). */
  prereqsCheck(): Promise<PrereqStatus[]>
  /** Allow-listed one-click fixes from the Setup screen (streams like an install). */
  setupFix(fix: SetupFix, onEvent: (event: RuntimeEvent) => void): Promise<RunHandle>
  cliLauncherStatus(): Promise<LauncherStatus>
  installCliLauncher(): Promise<LauncherStatus>
  repoInspect(path: string): Promise<RepoInfo>
  pickDirectory(): Promise<string | null>
  /** File picker (images, audio, 3D); empty when cancelled. */
  pickFiles(): Promise<string[]>
  /** Blueprint build folders: create, stats, import dropped files, copy between builds. */
  blueprintBuildDir(blueprint: string, build: string, base?: string): Promise<string>
  blueprintBuildStats(folder: string): Promise<{ fileCount: number; images: string[]; newestMs: number }>
  /** `skipExisting`: mirror semantics — a file with the same name and size is not copied again. */
  blueprintBuildImport(folder: string, paths: string[], sub?: string, skipExisting?: boolean): Promise<number>
  /** Same copy into `folder`, but returns the STORED names relative to `folder` (duplicates renamed `x-2.ext`), input order. */
  blueprintBuildImportPaths(folder: string, paths: string[]): Promise<string[]>
  blueprintBuildSend(from: string, to: string, sub?: string): Promise<number>
  /** Write a helper script under `<folder>/.silent/tools/<name>` (Uydurma placeholder tool). Returns the path. */
  blueprintWriteTool(folder: string, name: string, content: string): Promise<string>
  /** Pending `silent run …` request from the terminal launcher (consumed on read). */
  autostartTake(): Promise<AutostartRequest | null>
  /** Shallow-clone reference repositories into `<repo>/.silent/refs/<name>` (host side, no sandbox). */
  syncReferences(repoPath: string, refs: Array<{ name: string; url: string }>): Promise<Array<{ name: string; path: string; ok: boolean; error?: string }>>
  /** Create ~/CubeCode/<slug> (or the configured projects dir) and return its absolute path. */
  createProjectDir(name: string, base?: string): Promise<string>
  /** Native yes/no dialog (browser confirm() is not available inside the desktop webview). */
  confirm(message: string, title?: string): Promise<boolean>
  /** Denetçi: run one shell command in a project folder without a model; returns success, exit code and the output tail. */
  runCheck(cwd: string, command: string, timeoutSecs?: number, maxLines?: number, token?: string): Promise<CheckResult>
  /** Kill the process group of the check started with `token` (no-op when unknown); its result reports "cancelled". */
  checkCancel(token: string): Promise<void>
  /** Anlık Görüntü (Faz 4): git snapshot of the folder (hidden ref, working tree untouched); returns the ref. */
  gitSnapshot(cwd: string): Promise<string>
  /** Restore the working tree to a snapshot ref taken by gitSnapshot. */
  gitRestore(cwd: string, ref: string): Promise<void>
  /** Repo digest (Kaşe): bounded auto-summary of a project folder, cached under `.silent/digest.md` (see digest.rs). */
  repoDigest(root: string, maxBytes?: number): Promise<string>
  /** Text of `root/rel` (capped), or null when missing. */
  readProjectFile(root: string, rel: string, maxBytes?: number): Promise<string | null>
  /** Write `root/rel` (parents created; `rel` must stay inside `root`). */
  writeProjectFile(root: string, rel: string, content: string): Promise<void>
  /** Files under `root` modified at/after `sinceMs` (skips node_modules, .git, dist…); fallback when a CLI reports no file events. */
  changedFiles(root: string, sinceMs: number): Promise<string[]>
  /** Every file under `root` (node_modules, .git, .silent, dist, dotfiles skipped), sorted, capped (Dosyalar tab). */
  listProjectFiles(root: string, maxFiles?: number): Promise<ProjectFile[]>
  /** `root/rel` as a base64 blob with its mime type (image/audio/JSON previews), or null when missing. */
  readProjectBlob(root: string, rel: string, maxBytes?: number): Promise<ProjectBlob | null>
  openExternal(url: string): Promise<void>
  /** Show a folder in Finder / Explorer / the desktop file browser (4 clicks on a Build box). */
  openPath(path: string): Promise<void>
  /** Open an http(s) link in the system browser (the webview never navigates away from Silent). */
  openUrl(url: string): Promise<void>
  cliStart(request: CliRunRequest, onEvent: (event: RuntimeEvent) => void): Promise<RunHandle>
  kv: KvStore
  db: Repositories
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/** Host load sample for the load guard (Faz 3). */
export interface HostLoad {
  load1: number
  cpus: number
  swapUsedPct?: number
}

export interface CheckResult {
  ok: boolean
  exitCode: number | null
  tail: string
  elapsedMs: number
}

/** One entry of a project listing (slash-separated path relative to the root). */
export interface ProjectFile {
  rel: string
  size: number
  mtimeMs: number
}

/** A file's bytes for the webview: `data:${mime};base64,${base64}`. */
export interface ProjectBlob {
  mime: string
  base64: string
}
