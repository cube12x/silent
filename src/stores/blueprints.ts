import { create } from "zustand"
import { parseModelRef, type ProviderId } from "@/domain"
import { providerInfo } from "@/providers/registry"
import type { Blueprint, BpEdge, BpNode, BpNodeData, BpNodeType, CostMode, TerminalLine } from "@/domain"
import { TAMIRCI_BILINC_TITLE, TAMIRCI_TITLE, findTamirciBoxes, tamirciExtraPrompt, type TamirciRequest } from "@/engine/blueprint/tamirci"
import { newId } from "@/lib/ids"
import { getBackend } from "@/services"
import { useRunsStore } from "./runs"
import { useSettingsStore } from "./settings"
import { reportError } from "./notify"
import { useProvidersStore } from "./providers"
import { composeAiInput, firstIncoming, firstOutgoing, incoming, nodeById, outgoing, validateEdge, walkPlan, type AutorunRef } from "@/engine/blueprint/graph"
import { runSingle } from "@/engine/blueprint/single"
import { pickPlannerModel } from "@/engine/aiPlanner"
import { blueprintFromAuto, materializeAutoBlueprint, pickAutoBlueprintModel, requestAutoBlueprint } from "@/engine/blueprint/autoBlueprint"
import { BUILTIN_KITS } from "@/domain/kits"
import { UYDURMA_TOOL_NAME, UYDURMA_TOOL_SOURCE } from "@/engine/blueprint/uydurma"
import { DONUSTURUCU_TOOL_NAME, DONUSTURUCU_TOOL_SOURCE } from "@/engine/blueprint/donusturucu"
import { effectivePurpose, type BpReportKind, aiTaskText, buildAiPrompt, extractReport, isRepoUrl, repoName, type RefPath } from "@/engine/blueprint/prompt"
import { clampEffort } from "@/engine/effort"
import { useI18nStore } from "@/i18n"
import { formatTokens } from "@/lib/format"

interface BlueprintsState {
  blueprints: Blueprint[]
  activeId?: string
  /** Per-node live terminal lines (not persisted; batched, capped at 1500). */
  logs: Record<string, TerminalLine[]>
  /** Cancel handles of running nodes. */
  running: Record<string, () => Promise<void> | void>
  /** Undo/redo snapshots per blueprint (graph edits only, coalesced ~1 s; not persisted). */
  history: Record<string, Blueprint[]>
  future: Record<string, Blueprint[]>
  undo(id: string): void
  redo(id: string): void
  load(): Promise<void>
  create(name: string): Promise<Blueprint>
  remove(id: string): Promise<void>
  rename(id: string, name: string): Promise<void>
  setActive(id: string | undefined): void
  byId(id: string | undefined): Blueprint | undefined
  /** Immutable graph update + persist (debounced). `history: false` for run-state changes (status, execution ids). */
  update(id: string, mutate: (bp: Blueprint) => Blueprint, opts?: { history?: boolean }): void
  addNode(id: string, type: BpNodeType, x: number, y: number, data?: Record<string, unknown>): BpNode | undefined
  /** `data` is merged into the node's data (fields of the node's own type). */
  updateNode(id: string, nodeId: string, patch: Partial<Omit<BpNode, "data">> & { data?: Record<string, unknown> }): void
  removeNode(id: string, nodeId: string): void
  addEdge(id: string, from: string, to: string): string | null
  removeEdge(id: string, edgeId: string): void
  /** Execute from a node forward (Start/Enter): every AI reachable through wires, in order. */
  run(id: string, nodeId: string, opts?: { purpose?: string; extraPrompt?: string; resume?: boolean; only?: boolean }): Promise<void>
  cancel(id: string, nodeId: string): Promise<void>
  /** Send button: copy the wired build's files into the wired targets. */
  send(id: string, buttonId: string): Promise<void>
  /** What Enter / double-click / `silent bp` do for a node: Send copies, Reload re-runs with the wired AI's purpose, anything else runs forward. */
  trigger(id: string, nodeId: string, opts?: { reloadDefaultPurpose?: string; only?: boolean }): Promise<void>
  /** Answer every blocked worker question of the node's orchestration run (SILENT_QUESTION); sessions resume. Returns how many were answered. */
  answer(id: string, nodeId: string, text: string): number
  /** "AI ile oluştur": a planner-capable CLI (Claude first) designs a whole blueprint from a description. */
  autoCreate(description: string): Promise<Blueprint>
  /** "AI ile düzenle": the designer modifies the active blueprint in place (kept nodes keep ids and history). */
  autoEdit(id: string, description: string): Promise<void>
  /** Blueprint-level settings (Tamirci preset …). */
  setMeta(id: string, meta: Blueprint["meta"]): void
  /** Dosyalar tab → "Tamirci AI çağır": create/reuse the repair box(es) wired from the Build and run them with the request. */
  callTamirci(id: string, buildNodeId: string, req: TamirciRequest): Promise<{ nodeId: string }>
  /** Progress line of the auto-creation (undefined when idle). */
  autoStatus?: string
  /** Summary the designer wrote for the last auto-created blueprint. */
  autoSummary?: string
  /** Pending `silent bp …` request from autostart.json; the Blueprint screen consumes it once loaded. */
  autorun?: AutorunRef
  importFiles(id: string, nodeId: string, paths: string[]): Promise<number>
  refreshBuild(id: string, nodeId: string): Promise<void>
  /** Variable nodes: poll wired build folders and fire wizards/AIs on change. */
  tickWatchers(id: string): Promise<void>
}

const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
const watchSince = new Map<string, number>()

/** Settings › workspace folder (undefined = the backend default, ~/CubeCode). */
function workspaceDir(): string | undefined {
  return useSettingsStore.getState().settings.workspaceDir?.trim() || undefined
}

const LOG_CAP = 1500
const LOG_FLUSH_MS = 100
const pendingLogs = new Map<string, TerminalLine[]>()
let logFlushTimer: ReturnType<typeof setTimeout> | undefined

/** Append one terminal line to a node's log; lines are batched (100 ms) so a chatty CLI never re-renders the canvas per line. */
function log(set: (fn: (s: BlueprintsState) => Partial<BlueprintsState>) => void, nodeId: string, line: string, stream: TerminalLine["stream"] = "system") {
  const queue = pendingLogs.get(nodeId) ?? []
  queue.push({ ts: Date.now(), stream, text: line })
  pendingLogs.set(nodeId, queue)
  if (!logFlushTimer) logFlushTimer = setTimeout(() => flushNodeLogs(set), LOG_FLUSH_MS)
}

/** Publish batched lines into the store (also called directly by tests). */
export function flushNodeLogs(set: (fn: (s: BlueprintsState) => Partial<BlueprintsState>) => void = useBlueprintsStore.setState) {
  if (logFlushTimer) clearTimeout(logFlushTimer)
  logFlushTimer = undefined
  if (!pendingLogs.size) return
  const batch = new Map(pendingLogs)
  pendingLogs.clear()
  set((s) => {
    const logs = { ...s.logs }
    for (const [id, lines] of batch) {
      const merged = [...(logs[id] ?? []), ...lines]
      logs[id] = merged.length > LOG_CAP ? merged.slice(merged.length - LOG_CAP) : merged
    }
    return { logs }
  })
}

export const useBlueprintsStore = create<BlueprintsState>((set, get) => ({
  blueprints: [],
  logs: {},
  running: {},
  history: {},
  future: {},
  autorun: undefined,
  autoStatus: undefined,
  autoSummary: undefined,

  async load() {
    const backend = await getBackend()
    const blueprints = await backend.db.blueprints.list()
    set({ blueprints, activeId: get().activeId ?? blueprints[0]?.id })
    // A node left "running" has no executor after a restart (its run is marked cancelled by the runs store on load).
    for (const b of blueprints) {
      const stale = b.nodes.filter((n) => n.status === "running" && !get().running[n.id])
      if (stale.length) {
        get().update(b.id, (bp) => ({ ...bp, nodes: bp.nodes.map((n) => (stale.some((x) => x.id === n.id) ? { ...n, status: "failed", note: "interrupted (app restarted)" } : n)) }), { history: false })
        for (const n of stale) {
          log(set, n.id, "⚠ interrupted by an app restart — trigger again (sessions resume where possible)")
          // Credit what the interrupted run already consumed (the runs store is loaded before the screens).
          const run = n.executionId && !n.executionId.startsWith("session:") ? useRunsStore.getState().byId(n.executionId) : undefined
          if (run && n.data.type === "ai") addTokens(b.id, n.id, run.plan.reduce((acc, st) => acc + (st.tokens ?? 0), 0))
        }
      }
    }
    // Folder counts and photo mirrors are derived from disk; refresh them in the background.
    for (const b of blueprints) for (const n of b.nodes) if (n.type === "build" || n.type === "buildPhoto") void get().refreshBuild(b.id, n.id).catch(() => undefined)
  },
  setMeta(id, meta) {
    get().update(id, (bp) => ({ ...bp, meta: { ...(bp.meta ?? {}), ...(meta ?? {}) } }), { history: false })
  },
  async callTamirci(id, buildNodeId, req) {
    const store = get()
    const bp = store.byId(id)
    if (!bp) throw new Error("blueprint not found")
    const build = nodeById(bp, buildNodeId)
    if (!build || build.data.type !== "build") throw new Error("build not found")
    store.setMeta(id, { tamirci: req.preset })
    const found = findTamirciBoxes(bp)
    const base = { mode: "single", modelRef: req.preset.modelRef, instructions: req.preset.instructions?.trim() || undefined, repos: req.preset.repos?.filter((r) => r.url.trim()) ?? [], effort: req.preset.effort, tamirci: true }
    // Eylem/main box: below the Build, to the right; reused across requests so its terminal and tokens accumulate.
    let eylem = found.eylem
    if (!eylem) {
      eylem = store.addNode(id, "ai", build.x + 320, build.y + 220, { ...base, title: TAMIRCI_TITLE })
      if (!eylem) throw new Error("could not add the Tamirci box")
      store.addEdge(id, build.id, eylem.id)
    } else {
      store.updateNode(id, eylem.id, { data: { ...base, role: req.bilinc ? "eylem" : undefined } })
    }
    let bilinc = found.bilinc
    if (req.bilinc) {
      if (!bilinc) {
        bilinc = store.addNode(id, "ai", build.x + 320, build.y - 40, { ...base, role: "bilinc", title: TAMIRCI_BILINC_TITLE })
        if (bilinc) {
          store.addEdge(id, build.id, bilinc.id)
          store.addEdge(id, bilinc.id, eylem.id)
        }
      } else {
        store.updateNode(id, bilinc.id, { data: { ...base, role: "bilinc" } })
      }
      store.updateNode(id, eylem.id, { data: { role: "eylem" } })
    } else {
      store.updateNode(id, eylem.id, { data: { role: undefined } })
    }
    const extraPrompt = tamirciExtraPrompt(req)
    if (req.bilinc && bilinc) await store.run(id, bilinc.id, { extraPrompt, only: true })
    await store.run(id, eylem.id, { extraPrompt, only: true })
    return { nodeId: eylem.id }
  },

  async autoCreate(description) {
    const models = useProvidersStore.getState().availableModels()
    const model = pickAutoBlueprintModel(models)
    if (!model) throw new Error("no planner-capable CLI (Claude or Codex) is installed")
    set({ autoStatus: `${model.displayName}…`, autoSummary: undefined })
    try {
      const backend = await getBackend()
      const language = useI18nStore.getState().language
      const { result } = await requestAutoBlueprint(backend, { request: description, language, models, kits: BUILTIN_KITS }, model, (line) => set({ autoStatus: line.slice(0, 120) }))
      const materialized = materializeAutoBlueprint(result, models)
      const bp = blueprintFromAuto(result.name, materialized)
      set({ blueprints: [bp, ...get().blueprints], activeId: bp.id, autoStatus: undefined, autoSummary: result.summary })
      await backend.db.blueprints.upsert(bp)
      for (const w of materialized.warnings) log(set, bp.id, `⚠ ${w}`)
      return bp
    } catch (err) {
      set({ autoStatus: undefined })
      throw err
    }
  },
  async autoEdit(id, description) {
    const bp = get().byId(id)
    if (!bp) return
    const models = useProvidersStore.getState().availableModels()
    const model = pickAutoBlueprintModel(models)
    if (!model) throw new Error("no planner-capable CLI (Claude or Codex) is installed")
    set({ autoStatus: `${model.displayName}…`, autoSummary: undefined })
    try {
      const backend = await getBackend()
      const language = useI18nStore.getState().language
      const { result } = await requestAutoBlueprint(backend, { request: description, language, models, kits: BUILTIN_KITS, existing: bp }, model, (line) => set({ autoStatus: line.slice(0, 120) }))
      const materialized = materializeAutoBlueprint(result, models, bp)
      get().update(id, (b) => ({ ...b, name: result.name?.trim() || b.name, nodes: materialized.nodes, edges: materialized.edges }))
      set({ autoStatus: undefined, autoSummary: result.summary })
      for (const w of materialized.warnings) log(set, id, `⚠ ${w}`)
    } catch (err) {
      set({ autoStatus: undefined })
      throw err
    }
  },
  async create(name) {
    const now = Date.now()
    const bp: Blueprint = { id: newId("bp"), name: name.trim() || "Blueprint", nodes: [], edges: [], createdAt: now, updatedAt: now }
    set({ blueprints: [bp, ...get().blueprints], activeId: bp.id })
    await (await getBackend()).db.blueprints.upsert(bp)
    return bp
  },
  async remove(id) {
    set({ blueprints: get().blueprints.filter((b) => b.id !== id), activeId: get().activeId === id ? undefined : get().activeId })
    await (await getBackend()).db.blueprints.delete(id)
  },
  async rename(id, name) {
    get().update(id, (bp) => ({ ...bp, name: name.trim() || bp.name }))
  },
  setActive(id) {
    set({ activeId: id })
  },
  byId(id) {
    return id ? get().blueprints.find((b) => b.id === id) : undefined
  },
  update(id, mutate, opts) {
    const current = get().byId(id)
    if (!current) return
    const next = { ...mutate(current), updatedAt: Date.now() }
    if (opts?.history !== false) {
      const stack = get().history[id] ?? []
      const last = stack[stack.length - 1]
      // Typing and dragging produce many updates; keep one snapshot per ~second.
      const coalesce = last && Date.now() - last.updatedAt < 1000 && current.updatedAt - last.updatedAt < 1000
      const history = coalesce ? stack : [...stack, current].slice(-50)
      set({ history: { ...get().history, [id]: history }, future: { ...get().future, [id]: [] } })
    }
    set({ blueprints: get().blueprints.map((b) => (b.id === id ? next : b)) })
    clearTimeout(persistTimers.get(id))
    persistTimers.set(
      id,
      setTimeout(() => {
        const latest = get().byId(id)
        if (latest) void getBackend().then((b) => b.db.blueprints.upsert(latest)).catch((err) => console.error("blueprint persist failed", err))
      }, 400),
    )
  },
  undo(id) {
    const stack = get().history[id] ?? []
    const current = get().byId(id)
    const prev = stack[stack.length - 1]
    if (!prev || !current) return
    set({ history: { ...get().history, [id]: stack.slice(0, -1) }, future: { ...get().future, [id]: [...(get().future[id] ?? []), current] } })
    get().update(id, () => prev, { history: false })
  },
  redo(id) {
    const stack = get().future[id] ?? []
    const current = get().byId(id)
    const next = stack[stack.length - 1]
    if (!next || !current) return
    set({ future: { ...get().future, [id]: stack.slice(0, -1) }, history: { ...get().history, [id]: [...(get().history[id] ?? []), current] } })
    get().update(id, () => next, { history: false })
  },
  addNode(id, type, x, y, data) {
    const bp = get().byId(id)
    if (!bp) return undefined
    const defaults: Record<BpNodeType, BpNodeData> = {
      prompt: { type: "prompt", title: "", text: "" },
      ai: { type: "ai", modelRef: useProvidersStore.getState().availableModels()[0] ? `${useProvidersStore.getState().availableModels()[0].providerId}:${useProvidersStore.getState().availableModels()[0].id}` : "", mode: "orchestration" },
      build: { type: "build", title: "", folderPath: "", kind: "code" },
      buildPhoto: { type: "buildPhoto", title: "", folderPath: "", kind: "photo" },
      button: { type: "button", kind: "start" },
      variable: { type: "variable" },
      wizard: { type: "wizard", modelRef: "", purpose: "" },
      stub: { type: "stub", kinds: ["image", "sprite", "sfx", "music"], folder: "assets/uydurma" },
    }
    const node: BpNode = { id: newId("n"), type, x: Math.round(x), y: Math.round(y), data: { ...defaults[type], ...(data ?? {}) } as BpNodeData, status: "idle" }
    get().update(id, (b) => ({ ...b, nodes: [...b.nodes, node] }))
    return node
  },
  updateNode(id, nodeId, patch) {
    // Run state (status/note/executionId) is not an edit the user should undo.
    const edit = "data" in patch || "x" in patch || "y" in patch
    get().update(
      id,
      (b) => ({
        ...b,
        nodes: b.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch, data: { ...n.data, ...(patch.data ?? {}) } as BpNodeData } : n)),
      }),
      { history: edit },
    )
  },
  removeNode(id, nodeId) {
    get().update(id, (b) => ({ ...b, nodes: b.nodes.filter((n) => n.id !== nodeId), edges: b.edges.filter((e) => e.from !== nodeId && e.to !== nodeId) }))
  },
  addEdge(id, from, to) {
    const bp = get().byId(id)
    if (!bp) return "missing-blueprint"
    const problem = validateEdge(bp, { from, to })
    if (problem) return problem
    const edge: BpEdge = { id: newId("e"), from, to }
    get().update(id, (b) => ({ ...b, edges: [...b.edges, edge] }))
    return null
  },
  removeEdge(id, edgeId) {
    get().update(id, (b) => ({ ...b, edges: b.edges.filter((e) => e.id !== edgeId) }))
  },

  async run(id, nodeId, opts) {
    const bp = get().byId(id)
    if (!bp) return
    let plan = walkPlan(bp, nodeId)
    if (opts?.only) plan = plan.slice(0, 1)
    if (!plan.length) {
      log(set, nodeId, "⚠ no AI wired forward from this node")
      return
    }
    // Double-trigger guard: Enter pressed twice or `silent bp` repeated must not start a second run of the same node
    // (three concurrent orchestrations on one folder happened on 2026-09-26).
    const ais = plan.flatMap((st) => (st.kind === "ai" ? [st.node] : st.heads))
    const busy = ais.find((ai) => get().running[ai.id])
    if (busy) {
      log(set, nodeId, `⚠ ${busy.data.type === "ai" && busy.data.title ? busy.data.title : busy.id} is already running — wait or cancel it first`)
      return
    }
    for (const step of plan) {
      if (step.kind === "ai") {
        const ok = await execAi(id, step.node.id, opts)
        if (!ok) break
      } else {
        // Paralel button: every head starts now; the chain continues only when all of them are done.
        const names = step.heads.map((h) => (h.data.type === "ai" && h.data.title ? h.data.title : h.id))
        log(set, step.button.id, `⇉ ${step.heads.length} AI at once: ${names.join(", ")}`)
        get().updateNode(id, step.button.id, { status: "running", note: undefined })
        const results = await Promise.all(step.heads.map((h) => execAi(id, h.id, { ...opts, parallel: true })))
        const failed = results.filter((ok) => !ok).length
        get().updateNode(id, step.button.id, { status: failed ? "failed" : "done", note: failed ? `${failed}/${results.length} failed` : undefined })
        log(set, step.button.id, failed ? `✗ ${failed} of ${results.length} failed` : `✓ all ${results.length} done`)
        if (failed) break
      }
      opts = undefined
    }
  },
  async cancel(id, nodeId) {
    const stop = get().running[nodeId]
    if (stop) await stop()
    get().updateNode(id, nodeId, { status: "failed", note: "cancelled" })
  },
  answer(id, nodeId, text) {
    const bp = get().byId(id)
    const node = bp && nodeById(bp, nodeId)
    const runId = node?.executionId && !node.executionId.startsWith("session:") ? node.executionId : undefined
    const run = runId ? useRunsStore.getState().byId(runId) : undefined
    if (!run || !text.trim()) return 0
    let n = 0
    for (const st of run.plan) if (st.state === "blocked" && st.question && useRunsStore.getState().answer(run.id, st.id, text.trim())) n++
    if (n) log(set, nodeId, `↩ answered ${n} question(s): ${text.trim().slice(0, 80)}`)
    return n
  },
  async trigger(id, nodeId, opts) {
    const bp = get().byId(id)
    const node = bp && nodeById(bp, nodeId)
    if (!bp || !node) return
    if (node.data.type === "button" && node.data.kind === "send") return get().send(id, nodeId)
    if (node.data.type === "button" && node.data.kind === "reload") {
      const target = firstOutgoing(bp, nodeId, "ai")
      const purpose = target?.data.type === "ai" ? target.data.purpose : undefined
      return get().run(id, nodeId, { purpose: purpose || opts?.reloadDefaultPurpose || "Re-run for the same goal and fix what is broken.", resume: true, only: opts?.only })
    }
    return get().run(id, nodeId, { only: opts?.only })
  },
  async send(id, buttonId) {
    const bp = get().byId(id)
    if (!bp) return
    const backend = await getBackend()
    const source = firstIncoming(bp, buttonId, "build") ?? firstIncoming(bp, buttonId, "buildPhoto")
    if (!source || (source.data.type !== "build" && source.data.type !== "buildPhoto") || !source.data.folderPath) {
      log(set, buttonId, "⚠ wire a build into Send first")
      return
    }
    for (const target of outgoing(bp, buttonId)) {
      if ((target.data.type === "build" || target.data.type === "buildPhoto") && target.data.folderPath) {
        const n = await backend.blueprintBuildSend(source.data.folderPath, target.data.folderPath)
        log(set, buttonId, `→ ${target.data.title || target.id}: ${n} files`)
        await get().refreshBuild(id, target.id)
      } else if (target.type === "ai") {
        const cwd = aiWorkingFolder(bp, target.id)
        if (!cwd) {
          log(set, buttonId, "⚠ the AI has no build folder yet")
          continue
        }
        const n = await backend.blueprintBuildSend(source.data.folderPath, cwd, "inbox")
        log(set, buttonId, `→ ${target.id} inbox: ${n} files`)
        void get().run(id, target.id, { extraPrompt: `New files were delivered into ./inbox (${n} files from "${source.data.title}"). Use them for the task.`, resume: true }).catch((e) => reportError(e, "blueprint"))
      }
    }
  },
  async importFiles(id, nodeId, paths) {
    const bp = get().byId(id)
    const node = nodeById(bp!, nodeId)
    if (!bp || !node || (node.data.type !== "build" && node.data.type !== "buildPhoto")) return 0
    const backend = await getBackend()
    let folder = node.data.folderPath
    if (!folder) {
      folder = await backend.blueprintBuildDir(bp.name, node.data.title || "build", workspaceDir())
      get().updateNode(id, nodeId, { data: { folderPath: folder } })
    }
    const n = await backend.blueprintBuildImport(folder, paths)
    await get().refreshBuild(id, nodeId)
    return n
  },
  async refreshBuild(id, nodeId) {
    const bp = get().byId(id)
    const node = bp && nodeById(bp, nodeId)
    if (!bp || !node || (node.data.type !== "build" && node.data.type !== "buildPhoto")) return
    const backend = await getBackend()
    let folder = node.data.folderPath
    let imported = 0
    if (node.data.type === "buildPhoto") {
      // A photo build mirrors every image of the wired AI's build — including the screenshots workers take
      // under .silent/tmp — so "frames" never stay at 0 when the game draws its art in code. Existing files are skipped.
      const ai = firstIncoming(bp, nodeId, "ai")
      const source = ai && firstOutgoing(bp, ai.id, "build")
      const srcFolder = source?.data.type === "build" ? source.data.folderPath : ""
      if (srcFolder) {
        const src = await backend.blueprintBuildStats(srcFolder)
        if (src.images.length) {
          if (!folder) folder = await backend.blueprintBuildDir(bp.name, node.data.title || "photos", workspaceDir())
          imported = await backend.blueprintBuildImport(folder, src.images.map((rel) => `${srcFolder}/${rel}`), undefined, true)
        }
      }
    }
    if (!folder) return
    const stats = await backend.blueprintBuildStats(folder)
    if (stats.fileCount !== node.data.fileCount || folder !== node.data.folderPath) {
      const next = folder
      get().update(
        id,
        (b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === nodeId && (n.data.type === "build" || n.data.type === "buildPhoto") ? { ...n, data: { ...n.data, folderPath: next, fileCount: stats.fileCount } } : n)) }),
        { history: false },
      )
    }
    if (imported) log(set, nodeId, `${imported} image(s) collected`)
  },
  async tickWatchers(id) {
    const bp = get().byId(id)
    if (!bp) return
    const backend = await getBackend()
    for (const v of bp.nodes.filter((n) => n.type === "variable")) {
      const watched = firstIncoming(bp, v.id, "build") ?? firstIncoming(bp, v.id, "buildPhoto")
      if (!watched || (watched.data.type !== "build" && watched.data.type !== "buildPhoto") || !watched.data.folderPath) continue
      const since = watchSince.get(v.id) ?? Date.now()
      watchSince.set(v.id, Date.now())
      const changed = await backend.changedFiles(watched.data.folderPath, since - 1000).catch(() => [] as string[])
      const filter = v.data.type === "variable" ? v.data.filter : undefined
      const hits = filter ? changed.filter((p) => globMatch(filter, p)) : changed
      if (!hits.length) continue
      const event = { kind: "changed" as const, path: hits[0], at: Date.now() }
      get().updateNode(id, v.id, { status: "listening", data: { lastEvent: event } })
      log(set, v.id, `● ${hits.length} file(s): ${hits.slice(0, 3).join(", ")}`)
      for (const target of outgoing(bp, v.id)) {
        if (target.type === "wizard" && target.data.type === "wizard") {
          const ai = firstOutgoing(bp, target.id, "ai")
          if (!ai || !target.data.modelRef) continue
          get().updateNode(id, target.id, { status: "running" })
          const res = await runSingle(backend, {
            runId: `bp:${target.id}:${Date.now()}`,
            modelRef: target.data.modelRef,
            readOnly: true,
            cwd: watched.data.folderPath,
            timeoutSecs: 300,
            prompt: `You are a skill wizard with this purpose: ${target.data.purpose}\nEvent: ${hits.length} file(s) changed in ${watched.data.folderPath}: ${hits.slice(0, 20).join(", ")}.\nWrite ONLY the short instruction (1–3 sentences, with exact file paths) that the working AI needs to continue its task using these files. No preamble.`,
          }, (line, stream) => log(set, target.id, line, stream)).done
          get().updateNode(id, target.id, { status: res.ok ? "done" : "failed" })
          if (res.ok && res.text) void get().run(id, ai.id, { extraPrompt: res.text, resume: true }).catch((e) => reportError(e, "blueprint"))
        } else if (target.type === "ai") {
          void get().run(id, target.id, { extraPrompt: `Files changed in ${watched.data.folderPath}: ${hits.slice(0, 20).join(", ")}. Use them and continue.`, resume: true }).catch((e) => reportError(e, "blueprint"))
        }
      }
    }
  },
}))

function globMatch(pattern: string, path: string): boolean {
  const re = new RegExp("^" + pattern.trim().split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i")
  return re.test(path.split("/").pop() ?? path) || re.test(path)
}

/** The folder an AI node works in: the build wired into it (or into its prompt), else its output build. */
function aiWorkingFolder(bp: Blueprint, aiId: string): string | undefined {
  const { buildFolders } = composeAiInput(bp, aiId)
  if (buildFolders[0]) return buildFolders[0]
  const out = firstOutgoing(bp, aiId, "build")
  return out && out.data.type === "build" ? out.data.folderPath || undefined : undefined
}

async function waitForRun(runId: string): Promise<"completed" | "failed" | "cancelled"> {
  return new Promise((resolve) => {
    const check = () => {
      const run = useRunsStore.getState().byId(runId)
      if (run && (run.status === "completed" || run.status === "failed" || run.status === "cancelled")) {
        unsub()
        resolve(run.status)
      }
    }
    const unsub = useRunsStore.subscribe(check)
    check()
  })
}

/** Run one AI node: compose input, ensure a build folder, execute (orchestration or single), collect outputs. */
/** Token accounting is run state, not an edit: bypasses undo history. */
function addTokens(bpId: string, nodeId: string, delta: number) {
  if (!delta) return
  useBlueprintsStore.getState().update(
    bpId,
    (b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === nodeId && n.data.type === "ai" ? { ...n, data: { ...n.data, tokens: (n.data.tokens ?? 0) + delta } } : n)) }),
    { history: false },
  )
}

async function execAi(bpId: string, aiId: string, opts?: { purpose?: string; extraPrompt?: string; resume?: boolean; parallel?: boolean }): Promise<boolean> {
  const store = useBlueprintsStore.getState()
  const set = useBlueprintsStore.setState
  let bp = store.byId(bpId)
  const ai = bp && nodeById(bp, aiId)
  if (!bp || !ai || ai.data.type !== "ai") return false
  const mainRef = ai.data.modelRef || ai.data.pool?.[0] || ""
  const poolRefs = Array.from(new Set([mainRef, ...(ai.data.pool ?? [])].filter(Boolean)))
  if (!mainRef) {
    store.updateNode(bpId, aiId, { status: "failed", note: "no model" })
    return false
  }
  const backend = await getBackend()
  const { prompt: wired, buildFolders, promptTitles, stubs, fills } = composeAiInput(bp, aiId)
  const role = ai.data.role
  // Eylem: the reports of the Bilinç nodes wired into it are its work order. Every AI: the manifests of the
  // Dönüştürücü nodes wired into it tell it which converted files to use.
  const reports = incoming(bp, aiId).flatMap((n): Array<{ title: string; report: string; kind: BpReportKind }> => {
    if (n.data.type !== "ai" || !n.data.report?.trim()) return []
    if (n.data.role === "bilinc" && role === "eylem") return [{ title: n.data.title || n.id, report: n.data.report, kind: "bilinc" }]
    if (n.data.role === "donusturucu") return [{ title: n.data.title || n.id, report: n.data.report, kind: "donusturucu" }]
    return []
  })
  const purpose = effectivePurpose(role, ai.data.purpose, opts?.purpose)
  const task = aiTaskText({ purpose, wired, extraPrompt: opts?.extraPrompt, reports })
  if (!task && !fills.length) {
    store.updateNode(bpId, aiId, { status: "failed", note: "no prompt" })
    log(set, aiId, "⚠ wire a prompt into this AI")
    return false
  }
  // Working folder: wired build (develop) or a new build folder named after the prompt.
  let outBuild = firstOutgoing(bp, aiId, "build")
  if (ai.data.mode === "orchestration" && !opts?.parallel) {
    // One orchestration per folder: parallel workers of two runs would overwrite each other's files.
    // A Paralel button is a deliberate fan-out, so it bypasses this guard.
    const wired = buildFolders[0] || (outBuild && outBuild.data.type === "build" ? outBuild.data.folderPath : "")
    const clash = wired && useRunsStore.getState().runs.find((r) => r.status === "running" && r.repoPath === wired)
    if (clash) {
      log(set, aiId, `⚠ another run is already active on ${wired} (${clash.id}); wait for it or cancel it`)
      store.updateNode(bpId, aiId, { status: "failed", note: "folder busy: another run is active" })
      return false
    }
  }
  let createdBuild = false // a build Silent created now takes the AI-chosen name; user-titled builds keep theirs
  let cwd = buildFolders[0] || (outBuild && outBuild.data.type === "build" ? outBuild.data.folderPath : "")
  const title = promptTitles.find(Boolean) || (ai.data.title ?? "") || "build"
  if (!cwd) {
    cwd = await backend.blueprintBuildDir(bp.name, title, workspaceDir())
  }
  if (!outBuild) {
    // Develop flow (Build → Prompt → AI): the AI works inside that build, so the same Build node is updated
    // instead of growing a second node for the same folder. A Bilinç never produces a build (it only reads); a Dönüştürücü writes into the wired folder.
    const source = buildFolders[0] ? bp.nodes.find((n) => n.data.type === "build" && n.data.folderPath === buildFolders[0]) : undefined
    if (source) outBuild = source
    else if (role !== "bilinc" && role !== "donusturucu") {
      outBuild = store.addNode(bpId, "build", ai.x + 300, ai.y, { title, folderPath: cwd, kind: "code" })
      if (outBuild) store.addEdge(bpId, aiId, outBuild.id)
      createdBuild = true
    }
  } else if (outBuild.data.type === "build" && !outBuild.data.folderPath) {
    store.updateNode(bpId, outBuild.id, { data: { folderPath: cwd, title: outBuild.data.title || title } })
  }
  // Özel AI: clone the reference repositories into the working folder before the run.
  const repos = (ai.data.repos ?? []).filter((r) => isRepoUrl(r.url))
  let refPaths: RefPath[] = []
  if (repos.length) {
    log(set, aiId, `⎇ cloning ${repos.length} repo(s) into .silent/refs`)
    const synced = await backend.syncReferences(cwd, repos.map((r) => ({ name: repoName(r), url: r.url.trim() })))
    for (const r of synced) if (!r.ok) log(set, aiId, `⚠ clone failed: ${r.name}${r.error ? `: ${r.error}` : ""}`)
    refPaths = synced.filter((r) => r.ok).map((r) => ({ name: r.name, path: r.path, hint: repos.find((x) => repoName(x) === r.name)?.hint?.trim() || undefined }))
    if (!refPaths.length) {
      store.updateNode(bpId, aiId, { status: "failed", note: "repo clone failed" })
      return false
    }
  }
  if (stubs.length || fills.length) {
    // Uydurma: ship the placeholder tool into the build; buildAiPrompt prepends the policy.
    await backend.blueprintWriteTool(cwd, UYDURMA_TOOL_NAME, UYDURMA_TOOL_SOURCE)
    log(set, aiId, stubs.length ? `uydurma: placeholder policy (${Array.from(new Set(stubs.flatMap((s) => s.kinds))).join(", ")})` : "uydurma: fill job")
  }
  // Dönüştürücü: ship the converter tool into the working folder so this AI (and the converter role) can convert assets on
  // demand. Orchestration prompts go to the planner as the user's request, so the toolkit line is left to the worker briefs there.
  let converterTool = false
  try {
    await backend.blueprintWriteTool(cwd, DONUSTURUCU_TOOL_NAME, DONUSTURUCU_TOOL_SOURCE)
    converterTool = true
  } catch (e) {
    log(set, aiId, `⚠ converter tool not written: ${e instanceof Error ? e.message : String(e)}`)
  }
  const prompt = buildAiPrompt({ purpose, wired, extraPrompt: opts?.extraPrompt, instructions: ai.data.instructions, existingProjectAt: buildFolders[0] ? cwd : undefined, refPaths, stubs, fills, converterTool: converterTool && ai.data.mode !== "orchestration", imageTool: Boolean(providerInfo(parseModelRef(mainRef).providerId as ProviderId).capabilities.image), role, reports })
  // Orchestration gets a fresh run id after planning; drop the old one so badges do not show a previous run's tokens meanwhile.
  store.updateNode(bpId, aiId, { status: "running", note: undefined, executionId: ai.data.mode === "orchestration" ? undefined : ai.executionId })
  // Reserve the node NOW: planning takes a minute, and a second Enter/`silent bp` in that window used to start a
  // second orchestration on the same folder (2026-09-29, two runs 12 s apart). The real cancel handle replaces this.
  useBlueprintsStore.setState((s) => ({ running: { ...s.running, [aiId]: s.running[aiId] ?? (() => undefined) } }))
  log(set, aiId, `▶ ${poolRefs.join(" + ")} · ${ai.data.mode} · ${cwd}`)

  let ok: boolean
  let used: number
  let executionId: string | undefined
  let sessionId: string | undefined = ai.executionId?.startsWith("session:") ? ai.executionId.slice(8) : undefined
  if (ai.data.mode === "orchestration" && role !== "bilinc" && role !== "donusturucu") {
    const runs = useRunsStore.getState()
    const res = await runs.plan({ prompt, pool: poolRefs, executionMode: "staged", costMode: (ai.data.costMode ?? "balanced") as CostMode, repoPath: cwd, kitId: ai.data.kitId ?? "", polish: true, effort: ai.data.effort })
    if (res.source !== "ai") {
      log(set, aiId, `⚠ planner failed: ${res.error ?? "unknown"}`)
      store.updateNode(bpId, aiId, { status: "failed", note: res.error ?? "planner failed" })
      return false
    }
    const questions = (res.run.questions ?? []).map((q) => ({ ...q, answer: q.answer || "Decide yourself using best judgment; document the decision in README.md." }))
    const withAnswers = questions.length ? `${res.run.prompt}\n\nClarifications:\n${questions.map((q) => `- ${q.question} → ${q.answer}`).join("\n")}` : res.run.prompt
    executionId = res.run.id
    // Expose the run id immediately: the node badge and the Σ header read live subtask tokens through it.
    store.updateNode(bpId, aiId, { executionId })
    useBlueprintsStore.setState((s) => ({ running: { ...s.running, [aiId]: () => runs.cancel(res.run.id) } }))
    await runs.start({ ...res.run, prompt: withAnswers, questions, manual: false })
    log(set, aiId, `run ${res.run.id}: ${res.run.plan.length} tasks`)
    const status = await waitForRun(res.run.id)
    ok = status === "completed"
    const final = useRunsStore.getState().byId(res.run.id)
    used = (final?.plan ?? []).reduce((n, st) => n + (st.tokens ?? 0), 0)
    if (final?.report?.polishScore !== undefined) log(set, aiId, `polish ${final.report.polishScore}/10`)
  } else {
    const handle = runSingle(
      backend,
      { runId: `bp:${aiId}:${Date.now()}`, modelRef: mainRef, prompt: role === "bilinc" || role === "donusturucu" ? prompt : `${prompt}\n\nWhen done, reply with a concise summary of what you produced.`, cwd, readOnly: role === "bilinc", resumeSessionId: opts?.resume ? sessionId : undefined, effort: clampEffort(parseModelRef(mainRef).providerId as ProviderId, ai.data.effort) },
      (line, stream) => log(set, aiId, line, stream),
    )
    useBlueprintsStore.setState((s) => ({ running: { ...s.running, [aiId]: handle.cancel } }))
    const res = await handle.done
    ok = res.ok
    used = res.tokens
    if ((role === "bilinc" || role === "donusturucu" || ai.data.tamirci) && res.text.trim()) {
      // The report (from `# FINDINGS` / `# CONVERTED` on) is what the wired next node reads; the commentary before it is dropped.
      const report = extractReport(res.text)
      store.updateNode(bpId, aiId, { data: { report } })
      log(set, aiId, `📄 report: ${report.split("\n").length} lines`)
    }
    sessionId = res.sessionId ?? sessionId
    executionId = sessionId ? `session:${sessionId}` : undefined
    if (!ok) log(set, aiId, `✖ ${res.error ?? "failed"}`)
  }
  useBlueprintsStore.setState((s) => {
    const running = { ...s.running }
    delete running[aiId]
    return { running }
  })
  store.updateNode(bpId, aiId, { status: ok ? "done" : "failed", executionId, note: ok ? undefined : "failed" })
  addTokens(bpId, aiId, used)
  log(set, aiId, `${ok ? "✓" : "✖"} ${formatTokens(used)} tokens`)
  // Outputs: refresh the build, collect new images into a wired photo build, name an unnamed build.
  bp = useBlueprintsStore.getState().byId(bpId)!
  outBuild = (outBuild && nodeById(bp, outBuild.id)) || firstOutgoing(bp, aiId, "build")
  if (outBuild) {
    // The folder did not fail, the AI did: the Build shows red only while it is still empty.
    store.updateNode(bpId, outBuild.id, { data: { lastRunId: executionId }, status: ok ? "done" : "idle" })
    await store.refreshBuild(bpId, outBuild.id)
    const refreshed = nodeById(useBlueprintsStore.getState().byId(bpId)!, outBuild.id)
    if (!ok && refreshed?.data.type === "build" && (refreshed.data.fileCount ?? 0) > 0) store.updateNode(bpId, outBuild.id, { status: "done" })
  }
  const photo = firstOutgoing(bp, aiId, "buildPhoto")
  if (photo) await store.refreshBuild(bpId, photo.id)
  if (ok && outBuild && outBuild.data.type === "build" && (!outBuild.data.description || outBuild.data.title === "build")) {
    const namer = pickPlannerModel(useProvidersStore.getState().availableModels())
    if (namer) {
      const res = await runSingle(backend, {
        runId: `bp:name:${outBuild.id}:${Date.now()}`,
        modelRef: `${namer.providerId}:${namer.id}`,
        readOnly: true,
        cwd,
        timeoutSecs: 180,
        effort: "low",
        prompt: "Inspect this folder briefly (README, package manifest, top-level files). Reply with exactly two lines:\nNAME: <a short product name, 1-3 words>\nSUMMARY: <one sentence describing what this project is>",
      }).done
      addTokens(bpId, aiId, res.tokens)
      const name = /NAME:\s*(.+)/i.exec(res.text)?.[1]?.trim()
      const summary = /SUMMARY:\s*(.+)/i.exec(res.text)?.[1]?.trim()
      if (name || summary) store.updateNode(bpId, outBuild.id, { data: { title: (createdBuild || outBuild.data.title === "build") && name ? name.slice(0, 40) : outBuild.data.title, description: summary?.slice(0, 200) } })
    }
  }
  return ok
}

/** Poll variable watchers of the active blueprint every 3 s (started once by the screen). */
let watcherTimer: ReturnType<typeof setInterval> | undefined
export function startBlueprintWatchers(): void {
  if (watcherTimer) return
  watcherTimer = setInterval(() => {
    const { activeId, tickWatchers } = useBlueprintsStore.getState()
    if (activeId) void tickWatchers(activeId).catch((e) => reportError(e, "blueprint watcher"))
  }, 3000)
}
