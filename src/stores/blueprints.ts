import { create } from "zustand"
import { mapWithLimit } from "@/engine/loadGuard"
import { VERIFY_LANE_TIMEOUT_SECS, isInconclusiveLane, judgeLanes, laneCap, verifyNote } from "@/engine/blueprint/verify"
import { SOFT_SKIP_AFTER_TIMEOUTS, checkTimeoutFor, isCheckTimeout, softTimeoutFor } from "@/engine/blueprint/check"
import { useHostStore } from "@/stores/host"
import { isOrchestration, modelRef, parseModelRef, type ProviderId } from "@/domain"
import { providerInfo } from "@/providers/registry"
import type { Blueprint, BpEdge, BpModelData, BpNode, BpNodeData, BpNodeType, CostMode, ModelRequest, SilentCodeRun, TerminalLine } from "@/domain"
import { MODEL_DEFAULT_FOLDER, MODEL_DELIVERY_HEADING, MODEL_DOC_REL, MODEL_REQUESTS_HEADING, MODEL_STATE_REL, artDirectorBrief, converterBrief, decodeBase64, expectedFiles, frameName, matchDelivery, modelDoc, modelManifest, parseModelRequests, pendingSummary, probePng, validateDelivery, type AtlasJson, type PngProbe } from "@/engine/blueprint/model"
import { TAMIRCI_BILINC_TITLE, TAMIRCI_TITLE, findTamirciBoxes, tamirciExtraPrompt, type TamirciRequest } from "@/engine/blueprint/tamirci"
import { newId } from "@/lib/ids"
import { getBackend } from "@/services"
import { useRunsStore } from "./runs"
import { useUpdatesStore } from "./updates"
import { useSettingsStore } from "./settings"
import { reportError } from "./notify"
import { useProvidersStore } from "./providers"
import { composeAiInput, downstreamOf, firstIncoming, firstOutgoing, incoming, nodeById, outgoing, validateEdge, walkPlan, type AutorunRef } from "@/engine/blueprint/graph"
import { runSingle } from "@/engine/blueprint/single"
import { runSingleChain } from "@/engine/blueprint/singleChain"
import { pickPlannerModel } from "@/engine/aiPlanner"
import { blueprintFromAuto, materializeAutoBlueprint, pickAutoBlueprintModel, requestAutoBlueprint } from "@/engine/blueprint/autoBlueprint"
import { BUILTIN_KITS } from "@/domain/kits"
import { UYDURMA_TOOL_NAME, UYDURMA_TOOL_SOURCE } from "@/engine/blueprint/uydurma"
import { DONUSTURUCU_TOOL_NAME, DONUSTURUCU_TOOL_SOURCE } from "@/engine/blueprint/donusturucu"
import { defaultTaskForRole, effectivePurpose, type BpReportKind, aiTaskText, buildAiPrompt, extractReport, isRepoUrl, repoName, verifyLanePrompt, type RefPath } from "@/engine/blueprint/prompt"
import { clampEffort } from "@/engine/effort"
import { handoverBlock } from "@/engine/executor"
import { dosageWeights, orderByDosage } from "@/engine/dosage"
import { isModelRejected } from "@/engine/modelErrors"
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
  /** `touch: false` keeps `updatedAt` (derived-from-disk refreshes are not edits; they used to bump every blueprint at boot). */
  update(id: string, mutate: (bp: Blueprint) => Blueprint, opts?: { history?: boolean; touch?: boolean }): void
  addNode(id: string, type: BpNodeType, x: number, y: number, data?: Record<string, unknown>): BpNode | undefined
  /** `data` is merged into the node's data (fields of the node's own type). */
  updateNode(id: string, nodeId: string, patch: Partial<Omit<BpNode, "data">> & { data?: Record<string, unknown> }): void
  removeNode(id: string, nodeId: string): void
  addEdge(id: string, from: string, to: string): string | null
  removeEdge(id: string, edgeId: string): void
  /** Execute from a node forward (Start/Enter): every AI reachable through wires, in order. */
  run(id: string, nodeId: string, opts?: { purpose?: string; extraPrompt?: string; resume?: boolean; only?: boolean; modelRef?: string; /** Walk on from this node without running the node itself. */ skipHead?: boolean }): Promise<void>
  /** Kaldığı yerden devam: an orchestration box whose run failed or was cancelled resumes that run (completed tasks kept) and, when it completes, walks on to the boxes behind it. */
  resumeBox(id: string, nodeId: string, overrides?: Record<string, string>): Promise<boolean>
  /** The box's unfinished run that "Kaldığı yerden devam" would continue (its own run, else the latest stopped run on its folder). */
  resumableRun(id: string, nodeId: string): SilentCodeRun | undefined
  /** Devret: hand one task of the box's run to `toRef` and continue it from where it stopped (running run → live handover; stopped run → resume with that task re-routed). */
  handoverTask(id: string, nodeId: string, subtaskId: string, toRef: string): Promise<boolean>
  /** The box + task the user asked to hand over from the canvas (opens that row in the side panel). */
  focusTask?: { bpId: string; nodeId: string; subtaskId: string; at: number }
  setFocusTask(focus: { bpId: string; nodeId: string; subtaskId: string } | undefined): void
  cancel(id: string, nodeId: string): Promise<void>
  /** `silent cancel`: stop every running box of every blueprint; returns how many were stopped. */
  cancelAll(): Promise<number>
  /** Send button: copy the wired build's files into the wired targets. */
  send(id: string, buttonId: string): Promise<void>
  /** What Enter / double-click / `silent bp` do for a node: Send copies, Reload re-runs with the wired AI's purpose, anything else runs forward. */
  trigger(id: string, nodeId: string, opts?: { reloadDefaultPurpose?: string; only?: boolean }): Promise<void>
  /** Answer every blocked worker question of the node's orchestration run (SILENT_QUESTION); sessions resume. Returns how many were answered. */
  answer(id: string, nodeId: string, text: string): number
  /** Anlık Görüntü "Geri al": restore the wired folder to the node's last snapshot. */
  restoreSnapshot(id: string, nodeId: string): Promise<boolean>
  /** Görev aktarımı for a box: stop it (if running) and continue on `toRef` from the folder's current state. */
  handover(id: string, nodeId: string, toRef: string, opts?: { chain?: boolean }): Promise<void>
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
  /** Model Plus: hand files to the box (drop / "Dosya ekle" / `silent bp deliver`); they are matched, converted and validated. Returns how many were imported. */
  modelDeliver(id: string, nodeId: string, paths: string[], forName?: string): Promise<number>
  /** Model Plus: move a delivered file to another request and re-validate it. */
  modelReassign(id: string, nodeId: string, fromReqId: string, toReqId: string): Promise<void>
  /** Model Plus: accept a rejected request anyway (logged; the reasons stay on the request). */
  modelForceAccept(id: string, nodeId: string, reqId: string): Promise<void>
  /** Model Plus: throw the contract away and ask the art director again (deliveries in the inbox stay on disk). */
  modelRelist(id: string, nodeId: string): Promise<void>
  /** Model Plus, strict off: continue with what is accepted; the rest stays listed under # UNRESOLVED. */
  modelContinue(id: string, nodeId: string): Promise<void>
  /** Variable nodes: poll wired build folders and fire wizards/AIs on change. */
  tickWatchers(id: string): Promise<void>
}

const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
let watchersBusy = false

/** Refresh the folder counts / photo mirrors of one blueprint's Build boxes in the background (the screen the user looks at). */
function refreshBuildsOf(bpId: string | undefined): void {
  const st = useBlueprintsStore.getState()
  const bp = bpId ? st.byId(bpId) : undefined
  if (!bp) return
  for (const n of bp.nodes) if (n.type === "build" || n.type === "buildPhoto") void st.refreshBuild(bp.id, n.id).catch(() => undefined)
}
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
/** Longest a chain waits for a box another chain is running (2026-10-05: a leaked handle used to hang chains forever). */
const AWAIT_BUSY_MAX_MS = 30 * 60_000

/** Drop a box's cancel handle. Every executor releases through here (finally), so a crash or an early return can never leave a box "running". */
function releaseRunning(nodeId: string): void {
  useBlueprintsStore.setState((s) => {
    if (!(nodeId in s.running)) return {}
    const running = { ...s.running }
    delete running[nodeId]
    return { running }
  })
}

/** Resolves once the box has no cancel handle any more (or after `maxMs`). */
async function untilFree(nodeId: string, maxMs: number): Promise<void> {
  const until = Date.now() + maxMs
  while (useBlueprintsStore.getState().running[nodeId] && Date.now() < until) await new Promise((r) => setTimeout(r, 100))
}

/**
 * A box that is already running (another chain started it) is not started twice: the walk waits for it and treats a
 * green end as its own step done. Returns "free" when nothing was running.
 */
async function awaitBusy(bpId: string, nodeId: string, set: (fn: (s: BlueprintsState) => Partial<BlueprintsState>) => void): Promise<"free" | "done" | "failed"> {
  if (!useBlueprintsStore.getState().running[nodeId]) return "free"
  const bp = useBlueprintsStore.getState().byId(bpId)
  const node = bp && nodeById(bp, nodeId)
  const title = node && "title" in node.data && node.data.title ? node.data.title : nodeId
  log(set, nodeId, `⏳ ${title} is already running in another chain — waiting for it instead of starting it twice`)
  const deadline = Date.now() + AWAIT_BUSY_MAX_MS
  while (useBlueprintsStore.getState().running[nodeId]) {
    if (Date.now() > deadline) {
      log(set, nodeId, `✗ still busy after ${Math.round(AWAIT_BUSY_MAX_MS / 60000)} min — giving up on this chain (cancel the box if it is stuck)`)
      return "failed"
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  const after = useBlueprintsStore.getState().byId(bpId)
  const n = after && nodeById(after, nodeId)
  const ok = n?.status === "done"
  log(set, nodeId, ok ? "→ it finished green — the chain goes on" : "✗ it did not finish green — the chain stops here")
  return ok ? "done" : "failed"
}

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

let loadedOnce = false

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
    const rows = await backend.db.blueprints.list()
    // 2026-10-02: a `silent bp` trigger re-reads the DB while boxes run; a row whose upsert is still in flight is older
    // than memory and used to clobber it (a fixer that had just finished came back as "running" with no executor and
    // was marked interrupted). Keep whichever side is newer; only the first load after a restart marks orphans.
    const firstLoad = !loadedOnce
    loadedOnce = true
    const mem = get().blueprints
    const blueprints = rows.map((row) => {
      const cur = mem.find((m) => m.id === row.id)
      return cur && cur.updatedAt >= row.updatedAt ? cur : row
    })
    set({ blueprints, activeId: get().activeId ?? blueprints[0]?.id })
    if (!firstLoad) {
      refreshBuildsOf(get().activeId)
      return
    }
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
    // Folder counts and photo mirrors are derived from disk; refresh them in the background — for the ACTIVE blueprint
    // only (2026-10-05: every start walked the folders of all 18 blueprints, up to 20k entries each).
    refreshBuildsOf(get().activeId)
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
    const changed = id !== get().activeId
    set({ activeId: id })
    if (changed) refreshBuildsOf(id)
  },
  byId(id) {
    return id ? get().blueprints.find((b) => b.id === id) : undefined
  },
  update(id, mutate, opts) {
    const current = get().byId(id)
    if (!current) return
    const next = { ...mutate(current), updatedAt: opts?.touch === false ? current.updatedAt : Date.now() }
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
      check: { type: "check", commands: [], maxLines: 40, timeoutSecs: 900 },
      queue: { type: "queue", modelRef: useProvidersStore.getState().availableModels()[0] ? `${useProvidersStore.getState().availableModels()[0].providerId}:${useProvidersStore.getState().availableModels()[0].id}` : "" },
      snapshot: { type: "snapshot" },
      verify: { type: "verify", modelRef: (() => { const m = useProvidersStore.getState().availableModels().find((x) => providerInfo(x.providerId).capabilities.browser) ?? useProvidersStore.getState().availableModels()[0]; return m ? `${m.providerId}:${m.id}` : "" })(), lanes: [] },
      budget: { type: "budget", maxTokens: 200000 },
      model: { type: "model", modelRef: useProvidersStore.getState().availableModels()[0] ? `${useProvidersStore.getState().availableModels()[0].providerId}:${useProvidersStore.getState().availableModels()[0].id}` : "", folder: MODEL_DEFAULT_FOLDER, requests: [], strict: true },
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
    // Drain: a queued `silent update` installs itself once nothing runs — do not start new work meanwhile.
    if (useUpdatesStore.getState().pending) {
      log(set, nodeId, "⏸ an app update is queued (silent update) — new runs are refused until it is installed")
      return
    }
    let plan = walkPlan(bp, nodeId)
    if (opts?.only) plan = plan.slice(0, 1)
    if (opts?.skipHead && plan[0] && plan[0].kind !== "parallel" && plan[0].node.id === nodeId) plan = plan.slice(1)
    if (opts?.skipHead && !plan.length) return
    if (!plan.length) {
      log(set, nodeId, "⚠ no AI wired forward from this node")
      return
    }
    // Double-trigger guard: Enter pressed twice or `silent bp` repeated must not start a second run of the same node
    // (three concurrent orchestrations on one folder happened on 2026-09-26).
    // Only the FIRST step counts: a box running further down the walk belongs to another chain and is awaited when
    // the walk reaches it (2026-10-04: a Tamirci running on the hub refused the whole next stage for hours).
    const head = plan[0]!
    const headIds = head.kind === "parallel" ? head.heads.map((h) => h.id) : [head.node.id]
    const busyId = headIds.find((x) => get().running[x])
    if (busyId) {
      const busy = nodeById(bp, busyId)
      log(set, nodeId, `⚠ ${busy && "title" in busy.data && busy.data.title ? busy.data.title : busyId} is already running — wait or cancel it first`)
      return
    }
    // Boxes behind a Model Plus box that stopped to wait: skipped, while sibling branches keep walking (2026-10-05).
    const skip = new Set<string>()
    for (let step of plan) {
      try {
      const stepIds = step.kind === "parallel" ? step.heads.map((h) => h.id) : [step.node.id]
      if (stepIds.length && stepIds.every((x) => skip.has(x))) continue
      if (step.kind !== "parallel") {
        const waited = await awaitBusy(id, step.node.id, set)
        if (waited === "failed") break
        if (waited === "done") {
          opts = undefined
          continue
        }
      }
      if (step.kind === "ai") {
        const ok = await execAi(id, step.node.id, opts)
        if (!ok) break
      } else if (step.kind === "check" || step.kind === "verify") {
        // Denetçi / Çoklu Tarayıcı: green → the chain goes on. Red → the wired fixer AIs get the report, then the
        // check runs ONCE more: green → the chain continues (self-healing, 2026-10-01); still red → the chain stops.
        // A handed-over verify box (Devret) runs its lanes on the chosen model; the re-check after the fixer does too.
        const laneModel = step.kind === "verify" ? opts?.modelRef : undefined
        const exec = step.kind === "check" ? execCheck : (bpId: string, nid: string) => execVerify(bpId, nid, { modelRef: laneModel })
        let ok = await exec(id, step.node.id)
        // Inconclusive lanes (host overloaded, app did not start) are nothing to fix: skip the fixer, keep walking
        // (2026-10-04: a side-branch verify used to stop the Deploy/Denetçi steps queued behind it).
        if (ok === "inconclusive") {
          log(set, step.node.id, "→ inconclusive, nothing to fix — the chain goes on; replay the lanes when the host is idle")
          opts = undefined
          continue
        }
        // A cancelled check is not a red check: no fixer, no re-check (2026-10-05: cancelling an e2e Denetçi used to start the Eylem).
        if (ok === "cancelled") {
          log(set, step.node.id, "■ cancelled — the chain stops here")
          break
        }
        if (ok === "warn") ok = true
        if (!ok) {
          // Fixers are the Eylem (or Tamirci) boxes behind the gate; any other AI behind it is the continuation.
          const fixers = outgoing(bp, step.node.id).filter((n) => n.type === "ai" && n.data.type === "ai" && (n.data.role === "eylem" || n.data.tamirci === true))
          const continueOnFail = step.node.data.type === "check" && step.node.data.continueOnFail === true
          if (!fixers.length) {
            if (!continueOnFail) break
            log(set, step.node.id, "→ red with no fixer wired, but continueOnFail is on — the chain goes on")
          } else {
            for (const f of fixers) {
              try {
                // A fixer another chain is already running is awaited, never started twice (2026-10-05).
                const w = await awaitBusy(id, f.id, set)
                // The walk's head options (Devret model, handover brief, purpose) belong to the gate, never to its fixer
                // (2026-10-06: a verify box handed to Gemini ran its Codex fixer on Gemini too).
                if (w === "free") await execAi(id, f.id, { parallel: false })
              } catch (e) {
                log(set, f.id, `✖ fixer crashed: ${e instanceof Error ? e.message : String(e)}`)
              }
            }
            log(set, step.node.id, "↻ re-checking after the fixer")
            const after = nodeById(useBlueprintsStore.getState().byId(id)!, step.node.id)
            ok = step.kind === "verify" && after?.data.type === "verify" && after.data.failedLanes?.length ? await execVerify(id, step.node.id, { onlyLanes: after.data.failedLanes, modelRef: laneModel }) : await exec(id, step.node.id)
            if (ok === "cancelled") {
              log(set, step.node.id, "■ cancelled — the chain stops here")
              break
            }
            if (ok === "warn" || ok === "inconclusive") ok = true
            if (ok !== true && !continueOnFail) break
            if (ok !== true) log(set, step.node.id, "→ still red, but continueOnFail is on — the chain goes on")
          }
        }
      } else if (step.kind === "snapshot") {
        if (!(await execSnapshot(id, step.node.id))) break
      } else if (step.kind === "model") {
        // Model Plus: the walk stops here while the box waits for the user's assets; a delivery that completes the
        // contract re-runs the walk from this box (execModel then returns true at once).
        const r = await execModel(id, step.node.id)
        if (r === "waiting") {
          log(set, step.node.id, "⏸ waiting for the user's assets — the boxes behind this one resume once every request is accepted; sibling branches go on")
          for (const d of downstreamOf(bp, step.node.id)) skip.add(d)
          opts = undefined
          continue
        }
        if (!r) break
      } else if (step.kind === "queue") {
        if (!(await execQueue(id, step.node.id))) break
      } else {
        // Paralel button: every head starts now; the chain continues only when all of them are done.
        const waits = await Promise.all(step.heads.map((h) => awaitBusy(id, h.id, set)))
        if (waits.includes("failed")) break
        const heads = step.heads.filter((_, i) => waits[i] === "free")
        if (!heads.length) {
          opts = undefined
          continue
        }
        step = { ...step, heads }
        const names = step.heads.map((h) => (h.data.type === "ai" && h.data.title ? h.data.title : h.id))
        log(set, step.button.id, `⇉ ${step.heads.length} AI at once: ${names.join(", ")}`)
        get().updateNode(id, step.button.id, { status: "running", note: undefined })
        const results = await mapWithLimit(step.heads, () => useHostStore.getState().cap(), (h) => execAi(id, h.id, { ...opts, parallel: true }))
        const failed = results.filter((ok) => !ok).length
        get().updateNode(id, step.button.id, { status: failed ? "failed" : "done", note: failed ? `${failed}/${results.length} failed` : undefined })
        log(set, step.button.id, failed ? `✗ ${failed} of ${results.length} failed` : `✓ all ${results.length} done`)
        if (failed) break
      }
      opts = undefined
      } catch (e) {
        // A crash inside one step used to end the chain silently (2026-10-01: nothing ran after a Bölücü). Log it loudly and stop.
        const msg = e instanceof Error ? (e.stack ?? e.message) : String(e)
        const nid = step.kind === "parallel" ? step.button.id : step.node.id
        log(set, nid, `✖ step crashed: ${msg.slice(0, 400)}`)
        console.error(`[bp] step ${step.kind} crashed on ${nid}: ${msg}`)
        get().updateNode(id, nid, { status: "failed", note: "crashed (see log)" })
        break
      }
    }
  },
  resumableRun(id, nodeId) {
    const bp = get().byId(id)
    const node = bp && nodeById(bp, nodeId)
    if (!bp || !node || node.data.type !== "ai" || !isOrchestration(node.data.mode)) return undefined
    const resumable = (r: SilentCodeRun | undefined) => Boolean(r && (r.status === "failed" || r.status === "cancelled") && r.plan.some((st) => st.state === "completed") && r.plan.some((st) => st.state !== "completed"))
    const own = node.executionId && !node.executionId.startsWith("session:") ? useRunsStore.getState().byId(node.executionId) : undefined
    if (own) return resumable(own) ? own : undefined
    // No link (older builds cleared it on re-run): the latest stopped run on this box's folder from the last 3 days.
    const folder = aiWorkingFolder(bp, nodeId)
    if (!folder) return undefined
    return useRunsStore
      .getState()
      .runs.filter((r) => r.repoPath === folder && Date.now() - r.createdAt < 3 * 86_400_000)
      .sort((a, b) => b.createdAt - a.createdAt)
      .find(resumable)
  },
  setFocusTask(focus) {
    set({ focusTask: focus ? { ...focus, at: Date.now() } : undefined })
  },
  async handoverTask(id, nodeId, subtaskId, toRef) {
    const bp = get().byId(id)
    const node = bp && nodeById(bp, nodeId)
    if (!bp || !node || node.data.type !== "ai") return false
    const runId = node.executionId && !node.executionId.startsWith("session:") ? node.executionId : undefined
    const run = runId ? useRunsStore.getState().byId(runId) : undefined
    const task = run?.plan.find((st) => st.id === subtaskId)
    if (!runId || !run || !task) {
      log(set, nodeId, "⚠ handover: task not found in this box's run")
      return false
    }
    if (task.state === "completed") {
      log(set, nodeId, `⚠ handover: "${task.title}" is already done`)
      return false
    }
    if (run.status === "running") {
      const ok = useRunsStore.getState().handover(runId, subtaskId, toRef)
      log(set, nodeId, ok ? `↪ "${task.title}" → ${toRef}: continues from where it stopped` : `⚠ handover of "${task.title}" to ${toRef} was refused (see the task log)`)
      return ok
    }
    log(set, nodeId, `↪ "${task.title}" → ${toRef}: resuming the run with this task on the new model`)
    return get().resumeBox(id, nodeId, { [subtaskId]: toRef })
  },
  async resumeBox(id, nodeId, overrides) {
    const bp = get().byId(id)
    const node = bp && nodeById(bp, nodeId)
    if (!bp || !node || node.data.type !== "ai") return false
    const run = get().resumableRun(id, nodeId) ?? (node.executionId && !node.executionId.startsWith("session:") ? useRunsStore.getState().byId(node.executionId) : undefined)
    const runId = run?.id
    if (!runId || !run) {
      log(set, nodeId, "⚠ nothing to resume: this box has no unfinished orchestration run (run it with Enter instead)")
      return false
    }
    if (node.executionId !== runId) get().updateNode(id, nodeId, { executionId: runId })
    if (get().running[nodeId] || run.status === "running") {
      log(set, nodeId, "⚠ already running")
      return false
    }
    if (useUpdatesStore.getState().pending) {
      log(set, nodeId, "⏸ an app update is queued (silent update) — resume after it is installed")
      return false
    }
    const done = run.plan.filter((s) => s.state === "completed").length
    useBlueprintsStore.setState((s) => ({ running: { ...s.running, [nodeId]: () => useRunsStore.getState().cancel(runId) } }))
    try {
      get().updateNode(id, nodeId, { status: "running", note: `resuming · ${done}/${run.plan.length} done` })
      log(set, nodeId, `↻ resuming ${runId}: ${done}/${run.plan.length} tasks already done, the rest runs now`)
      const started = await useRunsStore.getState().resume(runId, overrides)
      if (!started) {
        get().updateNode(id, nodeId, { status: run.plan.every((s) => s.state === "completed") ? "done" : "failed", note: undefined })
        log(set, nodeId, "⚠ nothing left to resume")
        return false
      }
      const status = await waitForRun(runId)
      const final = useRunsStore.getState().byId(runId)
      addTokens(id, nodeId, (final?.plan ?? []).reduce((n, st) => n + (st.tokens ?? 0), 0) - run.plan.reduce((n, st) => n + (st.tokens ?? 0), 0))
      get().updateNode(id, nodeId, { status: status === "completed" ? "done" : "failed", note: status === "completed" ? undefined : status })
      log(set, nodeId, status === "completed" ? "✓ resumed run completed — the chain walks on" : `✖ resumed run ${status}`)
      if (status !== "completed") return false
    } finally {
      releaseRunning(nodeId)
    }
    await get().run(id, nodeId, { skipHead: true })
    return true
  },
  async cancel(id, nodeId) {
    const stop = get().running[nodeId]
    if (stop) {
      try {
        await stop()
      } catch (e) {
        log(set, nodeId, `⚠ cancel handle threw: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    // The executor normally releases the box itself; a stuck or crashed one must not keep it locked (2026-10-05).
    releaseRunning(nodeId)
    get().updateNode(id, nodeId, { status: "failed", note: "cancelled" })
  },
  async cancelAll() {
    const ids = Object.keys(get().running)
    let n = 0
    for (const nodeId of ids) {
      const owner = get().blueprints.find((b) => b.nodes.some((x) => x.id === nodeId))
      if (!owner) continue
      await get().cancel(owner.id, nodeId)
      n += 1
    }
    return n
  },
  async handover(id, nodeId, toRef, opts) {
    const bp = get().byId(id)
    const node = bp && nodeById(bp, nodeId)
    if (!node || (node.data.type !== "ai" && node.data.type !== "verify")) return
    const from = node.data.modelRef
    const tail = (get().logs[nodeId] ?? []).filter((l) => l.stream === "stdout").slice(-12).map((l) => l.text).join("\n").slice(-1500)
    const stop = get().running[nodeId]
    if (stop) {
      await stop()
      // The cancelled step still awaits its process and a sweep before it releases the box; starting the new run
      // before that hit the "already running" guard and the handover silently did nothing (2026-10-04).
      await untilFree(nodeId, 15_000)
    }
    log(set, nodeId, `↪ handover ${from} → ${toRef} (requested by the user)`)
    const extra = handoverBlock({ fromModel: from, reason: "handed over by the user", lastMessage: tail || undefined })
    // The UI's Aktar re-runs only this box; the CLI (`silent bp handover <bp> <box> <model>`) continues the chain after it.
    await get().run(id, nodeId, { only: !opts?.chain, modelRef: toRef, extraPrompt: extra })
  },
  async restoreSnapshot(id, nodeId) {
    const bp = get().byId(id)
    const node = bp && nodeById(bp, nodeId)
    if (!node || node.data.type !== "snapshot" || !node.data.ref || !node.data.folder) return false
    try {
      await (await getBackend()).gitRestore(node.data.folder, node.data.ref)
      log(set, nodeId, `↶ restored ${node.data.ref.split("/").pop()} in ${node.data.folder}`)
      get().updateNode(id, nodeId, { status: "done", note: "restored" })
      for (const b of bp.nodes) if ((b.data.type === "build" || b.data.type === "buildPhoto") && b.data.folderPath === node.data.folder) void get().refreshBuild(id, b.id)
      return true
    } catch (e) {
      log(set, nodeId, `✖ restore failed: ${e instanceof Error ? e.message : String(e)}`)
      get().updateNode(id, nodeId, { status: "failed", note: "restore failed" })
      return false
    }
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
  modelDeliver(id, nodeId, paths, forName) {
    return enqueueModel(nodeId, async () => {
      const bp = get().byId(id)
      const node = bp && nodeById(bp, nodeId)
      if (!bp || !node || node.data.type !== "model") return 0
      const cwd = sourceFolder(bp, nodeId)
      if (!cwd) {
        log(set, nodeId, "⚠ wire a Build into this box before delivering files")
        return 0
      }
      if (get().running[nodeId]) {
        log(set, nodeId, "⚠ the box is busy (director/converter running) — deliver again when it is waiting")
        return 0
      }
      if (!node.data.requests.length) {
        log(set, nodeId, "⚠ no requests yet — run the box first so the art director writes the contract")
        return 0
      }
      const backend = await getBackend()
      const inboxRel = `${node.data.folder.replace(/\/$/, "")}/inbox`
      // The real stored names: a clash with an earlier delivery is renamed (`mario-2.png`), and the converter must get THAT file.
      const stored = await backend.blueprintBuildImportPaths(`${cwd}/${inboxRel}`, paths)
      // Re-read after the await: another queued call may have changed the requests meanwhile.
      const fresh = get().byId(id) && nodeById(get().byId(id)!, nodeId)
      let requests = fresh && fresh.data.type === "model" ? fresh.data.requests : node.data.requests
      const touched = new Set<string>()
      paths.forEach((p, idx) => {
        const base = stored[idx] ?? (p.split("/").pop() ?? p)
        const req = matchDelivery(requests, p.split("/").pop() ?? p, forName)
        if (!req) {
          log(set, nodeId, `⚠ no open request matches "${base}" — it stays in ${inboxRel}; assign it from the panel`)
          return
        }
        if (req.status === "accepted") log(set, nodeId, `⚠ ${req.name} was already accepted — the new file replaces it`)
        requests = requests.map((r) => (r.id === req.id ? { ...r, status: "delivered" as const, delivered: { path: `${inboxRel}/${base}`, at: Date.now() }, reasons: undefined, outputs: undefined } : r))
        touched.add(req.id)
        log(set, nodeId, `📦 ${base} → ${req.name}`)
      })
      patchModel(id, nodeId, { continued: undefined })
      await saveModelRequests(id, nodeId, cwd, requests)
      if (touched.size) {
        await convertAndValidate(id, nodeId, Array.from(touched))
        await maybeResumeModel(id, nodeId)
      }
      return stored.length
    })
  },
  modelReassign(id, nodeId, fromReqId, toReqId) {
    return enqueueModel(nodeId, async () => {
    const bp = get().byId(id)
    const node = bp && nodeById(bp, nodeId)
    if (!bp || !node || node.data.type !== "model" || fromReqId === toReqId) return
    const cwd = sourceFolder(bp, nodeId)
    const from = node.data.requests.find((r) => r.id === fromReqId)
    if (!cwd || !from?.delivered) return
    const delivered = from.delivered
    const requests = node.data.requests.map((r) => (r.id === fromReqId ? { ...r, status: "pending" as const, delivered: undefined, reasons: undefined } : r.id === toReqId ? { ...r, status: "delivered" as const, delivered, reasons: undefined } : r))
    log(set, nodeId, `↪ ${delivered.path.split("/").pop()} reassigned ${from.name} → ${requests.find((r) => r.id === toReqId)?.name}`)
    await saveModelRequests(id, nodeId, cwd, requests)
    await convertAndValidate(id, nodeId, [toReqId])
    await maybeResumeModel(id, nodeId)
    })
  },
  modelForceAccept(id, nodeId, reqId) {
    return enqueueModel(nodeId, async () => {
    const bp = get().byId(id)
    const node = bp && nodeById(bp, nodeId)
    if (!bp || !node || node.data.type !== "model") return
    const cwd = sourceFolder(bp, nodeId)
    if (!cwd) return
    const requests = node.data.requests.map((r) => (r.id === reqId ? { ...r, status: "accepted" as const, reasons: [`forced by the user${r.reasons?.length ? ` — overrode: ${r.reasons.join("; ")}` : ""}`] } : r))
    log(set, nodeId, `⚠ ${requests.find((r) => r.id === reqId)?.name} accepted by force (the validator said no)`)
    await saveModelRequests(id, nodeId, cwd, requests)
    if (requests.every((r) => r.status === "accepted")) await maybeResumeModel(id, nodeId)
    else markModelWaiting(id, nodeId, requests)
    })
  },
  async modelRelist(id, nodeId) {
    const bp = get().byId(id)
    const node = bp && nodeById(bp, nodeId)
    if (!bp || !node || node.data.type !== "model") return
    if (get().running[nodeId]) {
      log(set, nodeId, "⚠ busy — wait for the running session first")
      return
    }
    const cwd = sourceFolder(bp, nodeId)
    log(set, nodeId, "🗑 contract discarded — asking the art director again (inbox files stay on disk)")
    patchModel(id, nodeId, { requests: [], report: undefined, lastOk: undefined, continued: undefined }, { status: "idle", note: undefined })
    if (cwd) await saveModelRequests(id, nodeId, cwd, [])
    await execModel(id, nodeId)
  },
  modelContinue(id, nodeId) {
    return enqueueModel(nodeId, async () => {
    const bp = get().byId(id)
    const node = bp && nodeById(bp, nodeId)
    if (!bp || !node || node.data.type !== "model") return
    if (node.data.strict !== false) {
      log(set, nodeId, "⚠ strict mode is on — every request must be accepted (turn strict off in the panel to continue with a partial contract)")
      return
    }
    if (!node.data.requests.some((r) => r.status === "accepted")) {
      log(set, nodeId, "⚠ nothing accepted yet — deliver at least one request")
      return
    }
    patchModel(id, nodeId, { continued: true })
    await maybeResumeModel(id, nodeId, true)
    })
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
        { history: false, touch: false },
      )
    }
    if (imported) log(set, nodeId, `${imported} image(s) collected`)
  },
  async tickWatchers(id) {
    // One tick at a time: a wizard call inside can take minutes while the 3 s interval keeps firing (2026-10-05).
    if (watchersBusy) return
    watchersBusy = true
    try {
      await tick()
    } finally {
      watchersBusy = false
    }
    async function tick() {
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

/** Denetçi: run the node's commands in the wired folder without any model; the report goes on the node. */
/** true = green, "warn" = green with red soft commands, false = red. */
async function execCheck(bpId: string, nodeId: string): Promise<boolean | "warn" | "cancelled"> {
  try {
    return await execCheckInner(bpId, nodeId)
  } finally {
    releaseRunning(nodeId)
  }
}

async function execCheckInner(bpId: string, nodeId: string): Promise<boolean | "warn" | "cancelled"> {
  const store = useBlueprintsStore.getState()
  const set = useBlueprintsStore.setState
  const bp = store.byId(bpId)
  const node = bp && nodeById(bp, nodeId)
  if (!bp || !node || node.data.type !== "check") return false
  const source = incoming(bp, nodeId)
  const buildIn = source.find((n) => n.data.type === "build" || n.data.type === "buildPhoto")
  const aiIn = source.find((n) => n.type === "ai")
  const cwd = (buildIn && (buildIn.data.type === "build" || buildIn.data.type === "buildPhoto") ? buildIn.data.folderPath : "") || (aiIn ? aiWorkingFolder(bp, aiIn.id) : undefined)
  if (!cwd) {
    store.updateNode(bpId, nodeId, { status: "failed", note: "no folder" })
    log(set, nodeId, "⚠ wire a Build (or an AI with a build) into this check")
    return false
  }
  const commands = node.data.commands.map((c) => c.trim()).filter(Boolean)
  const list = commands.length ? commands : ["npm run typecheck", "npm test", "npm run build"]
  const backend = await getBackend()
  let cancelled = false
  // The token lets a cancel kill the command's whole process group (2026-10-05: `npm run e2e` used to outlive the cancel).
  const token = `bp:check:${nodeId}:${Date.now()}`
  useBlueprintsStore.setState((s) => ({ running: { ...s.running, [nodeId]: async () => { cancelled = true; await backend.checkCancel(token).catch(() => undefined) } } }))
  store.updateNode(bpId, nodeId, { status: "running", note: undefined })
  log(set, nodeId, `▶ check · ${cwd}`)
  const data = node.data
  const soft = (data.softCommands ?? []).map((c) => c.trim()).filter(Boolean)
  const lines: string[] = ["# CHECK"]
  let ok = true
  let failingTail = ""
  const warnings: string[] = []
  // Soft time-out streaks: carried over only for commands still on the box (an edited list starts fresh).
  const softTimeouts: Record<string, number> = Object.fromEntries(Object.entries(data.softTimeouts ?? {}).filter(([c]) => soft.includes(c)))
  const runOne = async (cmd: string, isSoft: boolean): Promise<boolean> => {
    log(set, nodeId, `$ ${cmd}${isSoft ? "  (soft)" : ""}`)
    try {
      const r = await backend.runCheck(cwd, cmd, isSoft ? softTimeoutFor(data.timeoutSecs) : checkTimeoutFor(cmd, data.timeoutSecs), data.maxLines, token)
      if (isSoft) softTimeouts[cmd] = isCheckTimeout(r) ? (softTimeouts[cmd] ?? 0) + 1 : 0
      log(set, nodeId, r.tail || "(no output)", r.ok ? "stdout" : "stderr")
      log(set, nodeId, `↳ exit ${r.exitCode ?? "?"} · ${Math.round(r.elapsedMs / 1000)} s`)
      lines.push(`- ${cmd}: ${r.ok ? "ok" : `FAIL (exit ${r.exitCode ?? "timeout"})${isSoft ? " · soft, not blocking" : ""}`} · ${Math.round(r.elapsedMs / 1000)} s`)
      if (!r.ok) failingTail = r.tail
      return r.ok
    } catch (e) {
      failingTail = e instanceof Error ? e.message : String(e)
      lines.push(`- ${cmd}: could not run (${failingTail})${isSoft ? " · soft" : ""}`)
      return false
    }
  }
  for (const cmd of list) {
    if (cancelled) break
    if (!(await runOne(cmd, false))) {
      ok = false
      break
    }
  }
  // Soft commands (e2e on a slow host, lint-as-warning…): red ones are reported, never fixed, never block.
  if (ok && !cancelled) for (const cmd of soft) {
    if (cancelled) break
    if ((softTimeouts[cmd] ?? 0) >= SOFT_SKIP_AFTER_TIMEOUTS) {
      // 2026-10-05: never-green 40-minute soft e2e runs cost ~3.4 h over seven stages.
      lines.push(`- ${cmd}: skipped (timed out on the last ${softTimeouts[cmd]} runs — run it by hand, or edit the box to retry)`)
      log(set, nodeId, `⏭ ${cmd} skipped: timed out on the last ${softTimeouts[cmd]} runs (edit the box's soft commands to retry)`)
      warnings.push(`${cmd} (skipped)`)
      continue
    }
    if (!(await runOne(cmd, true))) warnings.push(cmd)
  }
  const report = ok && !warnings.length ? lines.join("\n") : `${lines.join("\n")}\n\nOutput of the failing command (last lines):\n${failingTail}`
  useBlueprintsStore.setState((s) => {
    const running = { ...s.running }
    delete running[nodeId]
    return { running }
  })
  const warn = ok && warnings.length > 0
  store.updateNode(bpId, nodeId, {
    status: cancelled ? "failed" : ok ? "done" : "failed",
    note: cancelled ? "cancelled" : !ok ? "check failed" : warn ? `⚠ soft red: ${warnings.join(", ")}` : undefined,
    data: { report, lastOk: ok && !cancelled, softTimeouts },
  })
  log(set, nodeId, !ok ? "✖ check failed — wired fixer AI gets the report" : warn ? `⚠ green with warnings — soft red: ${warnings.join(", ")} (chain goes on, no fixer)` : "✓ all checks green")
  if (cancelled) return "cancelled"
  if (!ok) return false
  return warn ? "warn" : true
}

/** Bütçe: cancel `runId` once its live tokens pass `maxTokens`; returns the unsubscribe. */
function watchBudget(bpId: string, budgetId: string, runId: string, maxTokens: number, onCut: (spent: number) => void): () => void {
  const store = useBlueprintsStore.getState()
  store.updateNode(bpId, budgetId, { status: "running", note: undefined })
  let cut = false
  const check = () => {
    const spent = useRunsStore.getState().usage[runId]?.tokens ?? 0
    if (spent > maxTokens && !cut) {
      cut = true
      useRunsStore.getState().cancel(runId)
      onCut(spent)
      store.updateNode(bpId, budgetId, { status: "failed", note: `cut at ${formatTokens(spent)}`, data: { spent } })
      reportError(`Bütçe: ${formatTokens(spent)} > ${formatTokens(maxTokens)} — run ${runId} cancelled`)
    }
  }
  const unsub = useRunsStore.subscribe(check)
  return () => {
    unsub()
    if (!cut) store.updateNode(bpId, budgetId, { status: "done", note: undefined, data: { spent: useRunsStore.getState().usage[runId]?.tokens ?? 0 } })
  }
}

/** Folder a non-AI box works on: the wired build, else the wired AI's working folder. */
function sourceFolder(bp: Blueprint, nodeId: string): string | undefined {
  const source = incoming(bp, nodeId)
  const buildIn = source.find((n) => n.data.type === "build" || n.data.type === "buildPhoto")
  const aiIn = source.find((n) => n.type === "ai")
  const viaButton = source.filter((n) => n.type === "button").flatMap((b) => incoming(bp, b.id)).find((n) => n.data.type === "build" || n.data.type === "buildPhoto")
  const pick = buildIn ?? viaButton
  return (pick && (pick.data.type === "build" || pick.data.type === "buildPhoto") ? pick.data.folderPath : "") || (aiIn ? aiWorkingFolder(bp, aiIn.id) : undefined)
}

/** Anlık Görüntü: git snapshot of the wired folder; zero tokens. */
async function execSnapshot(bpId: string, nodeId: string): Promise<boolean> {
  try {
    return await execSnapshotInner(bpId, nodeId)
  } finally {
    releaseRunning(nodeId)
  }
}

async function execSnapshotInner(bpId: string, nodeId: string): Promise<boolean> {
  const store = useBlueprintsStore.getState()
  const set = useBlueprintsStore.setState
  const bp = store.byId(bpId)
  const node = bp && nodeById(bp, nodeId)
  if (!bp || !node || node.data.type !== "snapshot") return false
  const cwd = sourceFolder(bp, nodeId)
  if (!cwd) {
    store.updateNode(bpId, nodeId, { status: "failed", note: "no folder" })
    log(set, nodeId, "⚠ wire a Build (or an AI with a build) into this snapshot")
    return false
  }
  // Hold the box while git runs: the busy guards, `isIdle` and cancel all key on this handle (2026-10-05).
  useBlueprintsStore.setState((s) => ({ running: { ...s.running, [nodeId]: () => undefined } }))
  store.updateNode(bpId, nodeId, { status: "running", note: undefined })
  try {
    const ref = await (await getBackend()).gitSnapshot(cwd)
    store.updateNode(bpId, nodeId, { status: "done", note: undefined, data: { ref, takenAt: Date.now(), folder: cwd } })
    log(set, nodeId, `📸 ${ref.split("/").pop()} · ${cwd}`)
    return true
  } catch (e) {
    store.updateNode(bpId, nodeId, { status: "failed", note: "snapshot failed" })
    log(set, nodeId, `✖ ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

/** Sıra: the wired prompts, one after another, in ONE CLI session (each step resumes the previous). */
async function execQueue(bpId: string, nodeId: string): Promise<boolean> {
  try {
    return await execQueueInner(bpId, nodeId)
  } finally {
    releaseRunning(nodeId)
  }
}

async function execQueueInner(bpId: string, nodeId: string): Promise<boolean> {
  const store = useBlueprintsStore.getState()
  const set = useBlueprintsStore.setState
  const bp = store.byId(bpId)
  const node = bp && nodeById(bp, nodeId)
  if (!bp || !node || node.data.type !== "queue") return false
  const data = node.data
  const steps = incoming(bp, nodeId).filter((n) => n.data.type === "prompt")
  const cwd = sourceFolder(bp, nodeId) ?? (() => { const b = firstOutgoing(bp, nodeId, "build"); return b && b.data.type === "build" ? b.data.folderPath : undefined })()
  if (!steps.length || !data.modelRef) {
    store.updateNode(bpId, nodeId, { status: "failed", note: steps.length ? "no model" : "no prompts" })
    return false
  }
  const backend = await getBackend()
  const digest = cwd ? await backend.repoDigest(cwd, 10 * 1024).catch(() => "") : ""
  let sessionId: string | undefined
  let cancelled = false
  let tokens = 0
  const lines: string[] = []
  store.updateNode(bpId, nodeId, { status: "running", note: undefined })
  log(set, nodeId, `▶ ${data.modelRef} · ${steps.length} steps in one session${cwd ? ` · ${cwd}` : ""}`)
  let ok = true
  for (const [i, step] of steps.entries()) {
    if (cancelled || step.data.type !== "prompt") break
    const title = step.data.title || `step ${i + 1}`
    log(set, nodeId, `── ${i + 1}/${steps.length} ${title}`)
    const body = `${step.data.title ? `# ${step.data.title}\n` : ""}${step.data.text}`
    const prompt = sessionId
      ? `NEXT STEP (${i + 1}/${steps.length}) in the same project — the previous steps of this session are done; keep what you learned, do only this:\n\n${body}\n\nWhen done, reply with a concise summary (at most 10 lines).`
      : buildAiPrompt({ wired: body, existingProjectAt: cwd, digest }) + "\n\nWhen done, reply with a concise summary (at most 10 lines)."
    const handle = runSingle(backend, { runId: `bp:queue:${nodeId}:${Date.now()}`, modelRef: data.modelRef, prompt, cwd, resumeSessionId: sessionId }, (line, stream) => log(set, nodeId, line, stream))
    useBlueprintsStore.setState((s) => ({ running: { ...s.running, [nodeId]: async () => { cancelled = true; await handle.cancel() } } }))
    const res = await handle.done
    tokens += res.tokens
    sessionId = res.sessionId ?? sessionId
    lines.push(`- ${title}: ${res.ok ? "ok" : `FAILED (${res.error ?? "?"})`}${res.text.trim() ? ` — ${res.text.trim().split("\n").at(-1)?.slice(0, 160)}` : ""}`)
    if (!res.ok) {
      ok = false
      break
    }
  }
  useBlueprintsStore.setState((s) => {
    const running = { ...s.running }
    delete running[nodeId]
    return { running }
  })
  store.updateNode(bpId, nodeId, { status: cancelled ? "failed" : ok ? "done" : "failed", note: cancelled ? "cancelled" : ok ? undefined : "a step failed", executionId: sessionId ? `session:${sessionId}` : undefined, data: { report: lines.join("\n") } })
  log(set, nodeId, `${ok && !cancelled ? "✓" : "✖"} ${formatTokens(tokens)} tokens`)
  const outBuild = firstOutgoing(bp, nodeId, "build")
  if (outBuild) await store.refreshBuild(bpId, outBuild.id)
  return ok && !cancelled
}

/** Çoklu Tarayıcı: every lane in parallel (host load cap), findings merged into one `# VERIFY` report. */
/** Returns true when every lane is OK, false when lanes have findings (the wired fixer runs), "inconclusive" when lanes
 * could only not be driven (host overloaded, app did not start): nothing to fix, replay later. */
async function execVerify(bpId: string, nodeId: string, opts?: { onlyLanes?: string[]; modelRef?: string }): Promise<boolean | "inconclusive" | "cancelled"> {
  try {
    return await execVerifyInner(bpId, nodeId, opts)
  } finally {
    releaseRunning(nodeId)
  }
}

async function execVerifyInner(bpId: string, nodeId: string, opts?: { onlyLanes?: string[]; modelRef?: string }): Promise<boolean | "inconclusive" | "cancelled"> {
  const store = useBlueprintsStore.getState()
  const set = useBlueprintsStore.setState
  const bp = store.byId(bpId)
  const node = bp && nodeById(bp, nodeId)
  if (!bp || !node || node.data.type !== "verify") return false
  const data = node.data
  const cwd = sourceFolder(bp, nodeId)
  const allLanes = data.lanes.map((l) => l.trim()).filter(Boolean)
  // Re-check after the fixer: replay only the lanes that had findings; the others keep their OK from the previous pass.
  const lanes = opts?.onlyLanes?.length ? allLanes.filter((l) => opts.onlyLanes!.includes(l)) : allLanes
  const skipped = allLanes.filter((l) => !lanes.includes(l))
  // Devret: a hand-over runs the lanes on another model; the box keeps its own setting.
  const laneRef = opts?.modelRef || data.modelRef
  if (!cwd || !lanes.length || !laneRef) {
    store.updateNode(bpId, nodeId, { status: "failed", note: !cwd ? "no folder" : !lanes.length ? "no lanes" : "no model" })
    return false
  }
  // Host policy (2026-10-04): on a critically loaded host the lanes only burn tokens and report "could not be driven".
  // Skip them as inconclusive now; `failedLanes` keeps them for a replay when the host is idle.
  if (useHostStore.getState().level !== "ok") {
    const report = ["# VERIFY", ...lanes.map((l) => `## ${l}\n- [inconclusive] skipped: host busy (${useHostStore.getState().level}) — replay when idle`), ...(skipped.length ? [`## skipped (OK on the previous pass)\n${skipped.map((l) => `- ${l}`).join("\n")}`] : [])].join("\n\n")
    store.updateNode(bpId, nodeId, { status: "failed", note: `${lanes.length}/${lanes.length} lanes inconclusive (host busy) — re-run when idle`, data: { ...data, report, lastOk: true, failedLanes: lanes } })
    log(set, nodeId, `⚠ host busy (${useHostStore.getState().level}) — ${lanes.length} lane(s) skipped as inconclusive (no browser started); replay later`)
    return "inconclusive"
  }
  const backend = await getBackend()
  const cancels: Array<() => Promise<void>> = []
  let cancelled = false
  useBlueprintsStore.setState((s) => ({ running: { ...s.running, [nodeId]: async () => { cancelled = true; await Promise.all(cancels.map((c) => c())) } } }))
  store.updateNode(bpId, nodeId, { status: "running", note: undefined })
  log(set, nodeId, `▶ ${lanes.length} lanes · ${laneRef} · ${cwd}`)
  // Lanes drive a browser: a rejected lane model hands over only to browser-capable models — the fallback model, and
  // (Settings → browser fallback outside the pool) the available catalog models, strongest first.
  const settings = useSettingsStore.getState().settings
  const browserOk = (ref: string) => Boolean(providerInfo(parseModelRef(ref).providerId as ProviderId)?.capabilities.browser)
  const tierRank: Record<string, number> = { frontier: 2, strong: 1, fast: 0 }
  const lanePool = settings.browserFallbackOutsidePool
    ? useProvidersStore.getState().availableModels().filter((m) => providerInfo(m.providerId)?.capabilities.browser).sort((a, b) => (tierRank[b.tier] ?? 0) - (tierRank[a.tier] ?? 0)).map((m) => modelRef(m.providerId, m.id))
    : []
  const laneFallback = settings.fallbackModelRef && browserOk(settings.fallbackModelRef) ? settings.fallbackModelRef : undefined
  let rejected: { ref: string; error: string } | undefined
  // Fail fast (2026-10-05): when one lane cannot be driven (overloaded host, app does not start), the others cannot either —
  // 4B and 4C each spent ~2 h on lanes that all came back inconclusive. Remaining lanes are not started.
  let giveUp: string | undefined
  const results = await mapWithLimit(lanes, () => laneCap(useHostStore.getState().level, useHostStore.getState().cap()), async (lane) => {
    if (cancelled) return { lane, ok: false, text: "", tokens: 0 }
    if (giveUp) return { lane, ok: true, text: `# VERIFY\n- INCONCLUSIVE: skipped after lane "${giveUp.slice(0, 60)}" could not be driven`, tokens: 0 }
    if (rejected) return { lane, ok: false, text: "", tokens: 0 }
    const unavailable = useProvidersStore.getState().unavailable
    // A model an earlier lane found exhausted is skipped: lanes start on the first usable one.
    const start = [laneRef, ...lanePool, ...(laneFallback ? [laneFallback] : [])].find((r) => !unavailable.includes(r)) ?? laneRef
    const { res, usedRef } = await runSingleChain({
      mainRef: start,
      pool: lanePool,
      fallbackRef: laneFallback,
      start: (ref, extra) => {
        const h = runSingle(backend, { runId: `bp:verify:${nodeId}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`, modelRef: ref, prompt: extra ? `${verifyLanePrompt(lane, cwd)}\n\n${extra}` : verifyLanePrompt(lane, cwd), cwd, timeoutSecs: VERIFY_LANE_TIMEOUT_SECS }, (line, stream) => log(set, nodeId, `[${lane.slice(0, 24)}] ${line}`, stream))
        cancels.push(h.cancel)
        return h
      },
      onCancel: () => {},
      unavailable: () => useProvidersStore.getState().unavailable,
      markUnavailable: (ref, reason) => useProvidersStore.getState().markUnavailable(ref, reason),
      log: (line) => log(set, nodeId, `[${lane.slice(0, 24)}] ${line}`),
      onWait: () => {},
      // Lanes do not sit out a quota reset: the box goes red with the reason and can be handed over.
      maxWaitMs: 0,
    })
    if (!res.ok && res.error && isModelRejected(res.error) && !rejected) {
      rejected = { ref: usedRef === start ? start : `${start} → ${usedRef}`, error: res.error }
      log(set, nodeId, `⏭ ${rejected.ref} rejected the lane (${res.error.slice(0, 80)}) — the remaining lanes are not started`)
    }
    const text = extractReport(res.text)
    if (!giveUp && isInconclusiveLane(text)) {
      giveUp = lane
      log(set, nodeId, `⏭ lane "${lane.slice(0, 40)}" could not be driven — the remaining lanes are skipped (replay when the host is idle)`)
    }
    return { lane, ok: res.ok, text, tokens: res.tokens }
  })
  const tokens = results.reduce((n, r) => n + r.tokens, 0)
  // Lanes start dev servers and browsers; nothing waits for them once the lane is done.
  const swept = await backend.projectSweep(cwd).catch(() => 0)
  if (swept) log(set, nodeId, `🧹 swept ${swept} leftover browser/dev-server process(es)`)
  const verdict = judgeLanes(results)
  const findings = verdict.findings
  const inconclusive = verdict.inconclusive
  const report = ["# VERIFY", ...results.map((r) => {
    if (verdict.ok.includes(r.lane)) return `## ${r.lane}\n- OK`
    if (inconclusive.some((x) => x.lane === r.lane)) return `## ${r.lane}\n- [inconclusive] lane could not be driven — not a product finding, replay when the host is idle (${(r.text.replace(/^# VERIFY\s*/i, "").trim() || "no output").slice(0, 300)})`
    return `## ${r.lane}\n${r.text.replace(/^# VERIFY\s*/i, "").trim()}`
  }), ...(skipped.length ? [`## skipped (OK on the previous pass)\n${skipped.map((l) => `- ${l}`).join("\n")}`] : [])].join("\n\n")
  const allOk = findings.length === 0 && inconclusive.length === 0 && !cancelled
  const onlyInconclusive = !cancelled && findings.length === 0 && inconclusive.length > 0
  useBlueprintsStore.setState((s) => {
    const running = { ...s.running }
    delete running[nodeId]
    return { running }
  })
  const replay = [...findings, ...inconclusive].map((r) => r.lane)
  store.updateNode(bpId, nodeId, {
    status: cancelled ? "failed" : allOk ? "done" : "failed",
    note: cancelled ? "cancelled" : allOk ? undefined : verifyNote({ lanes: lanes.length, findings: findings.length, inconclusive: inconclusive.length, rejected }),
    // lastOk is the fixer's work-order switch (execAi reads verify reports only when it is false); inconclusive-only
    // passes have nothing to fix, so they stay "ok" for the fixer while the box itself shows the replay list.
    data: { ...data, report, lastOk: findings.length === 0 && !cancelled, failedLanes: allOk ? [] : replay, tokens: (data.tokens ?? 0) + tokens },
  })
  log(set, nodeId, `${allOk ? "✓ all lanes OK" : onlyInconclusive ? `⚠ ${inconclusive.length} lane(s) inconclusive — ${rejected ? `${rejected.ref} rejected the work; hand the box over or re-run later` : "host overloaded or app did not start; re-run when idle"} (no fixer)` : `✖ ${findings.length} lane(s) with findings — wired fixer AI gets the report${inconclusive.length ? ` (${inconclusive.length} inconclusive, replayed later)` : ""}`} · ${formatTokens(tokens)} tokens`)
  if (onlyInconclusive) return "inconclusive"
  if (cancelled) return "cancelled"
  return allOk
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
    (b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === nodeId && (n.data.type === "ai" || n.data.type === "model") ? { ...n, data: { ...n.data, tokens: (n.data.tokens ?? 0) + delta } } : n)) }),
    { history: false },
  )
}

/** Persist a model box's requests (node data is the source of truth; the file is the restart-safe, scriptable mirror). */
/** Patch a model box's data as run state (no undo history: Cmd+Z must never revert deliveries the disk already has). */
function patchModel(bpId: string, nodeId: string, data: Partial<BpModelData>, rest?: { status?: BpNode["status"]; note?: string }): void {
  useBlueprintsStore.getState().update(
    bpId,
    (b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === nodeId && n.data.type === "model" ? { ...n, ...(rest?.status !== undefined ? { status: rest.status } : {}), ...(rest && "note" in rest ? { note: rest.note } : {}), data: { ...n.data, ...data } } : n)) }),
    { history: false },
  )
}

/** Serialise the model box's mutations (deliver / reassign / force / continue): two quick drops used to race each other. */
const modelQueues = new Map<string, Promise<unknown>>()
function enqueueModel<T>(nodeId: string, fn: () => Promise<T>): Promise<T> {
  const prev = modelQueues.get(nodeId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  modelQueues.set(nodeId, next.catch(() => undefined))
  return next
}

async function saveModelRequests(bpId: string, nodeId: string, cwd: string, requests: ModelRequest[]): Promise<void> {
  patchModel(bpId, nodeId, { requests })
  const backend = await getBackend()
  await backend.writeProjectFile(cwd, MODEL_STATE_REL, JSON.stringify({ version: 1, updatedAt: Date.now(), requests }, null, 2)).catch((e) => log(useBlueprintsStore.setState, nodeId, `⚠ could not write ${MODEL_STATE_REL}: ${e instanceof Error ? e.message : String(e)}`))
}

/**
 * Model Plus step. Returns true when every request is accepted (the walk goes on), "waiting" when the box stopped the
 * chain for the user's deliveries, false on failure. Phases are idempotent: a re-run picks up where the data says.
 */
async function execModel(bpId: string, nodeId: string): Promise<boolean | "waiting"> {
  const store = useBlueprintsStore.getState()
  const set = useBlueprintsStore.setState
  const bp = store.byId(bpId)
  const node = bp && nodeById(bp, nodeId)
  if (!bp || !node || node.data.type !== "model") return false
  const cwd = sourceFolder(bp, nodeId)
  if (!cwd) {
    store.updateNode(bpId, nodeId, { status: "failed", note: "no folder" })
    log(set, nodeId, "⚠ wire a Build (or an AI with a build) into this box")
    return false
  }
  if (!node.data.modelRef) {
    store.updateNode(bpId, nodeId, { status: "failed", note: "no model" })
    return false
  }
  const data = node.data
  if (data.requests.length) {
    // Deliveries interrupted by a restart: finish their conversion first.
    const stale = data.requests.filter((r) => r.status === "delivered").map((r) => r.id)
    if (stale.length) await convertAndValidate(bpId, nodeId, stale)
    const now = (useBlueprintsStore.getState().byId(bpId) && nodeById(useBlueprintsStore.getState().byId(bpId)!, nodeId)?.data) as BpModelData | undefined
    const requests = now?.requests ?? data.requests
    const complete = requests.every((r) => r.status === "accepted")
    const partialOk = now?.strict === false && now.continued === true && requests.some((r) => r.status === "accepted")
    if (complete || partialOk) {
      patchModel(bpId, nodeId, { report: modelManifest(requests), lastOk: true }, { status: "done", note: complete ? undefined : `${requests.filter((r) => r.status !== "accepted").length} unresolved (continued)` })
      return true
    }
    patchModel(bpId, nodeId, { report: undefined, lastOk: undefined })
    return markModelWaiting(bpId, nodeId, requests)
  }
  // SPEC: the art director writes the contract.
  const backend = await getBackend()
  const handleRef: { cancel?: () => Promise<void> } = {}
  useBlueprintsStore.setState((s) => ({ running: { ...s.running, [nodeId]: async () => { await handleRef.cancel?.() } } }))
  store.updateNode(bpId, nodeId, { status: "running", note: "art director" })
  log(set, nodeId, `▶ art director · ${data.modelRef} · ${cwd}`)
  const digest = await backend.repoDigest(cwd, 12 * 1024).catch(() => "")
  const stubFolder = bp.nodes.find((n) => n.data.type === "stub")?.data
  const uydurmaRel = stubFolder && stubFolder.type === "stub" ? `${stubFolder.folder.replace(/\/$/, "")}/uydurma.json` : "assets/uydurma/uydurma.json"
  const uydurma = (await backend.readProjectFile(cwd, uydurmaRel, 64 * 1024).catch(() => null)) ?? undefined
  const kitAi = incoming(bp, nodeId).find((n) => n.data.type === "ai" && n.data.kitId)
  const kit = kitAi && kitAi.data.type === "ai" ? kitAi.data.kitId : undefined
  const prompt = artDirectorBrief({ digest, uydurma, kit, style: data.style, folder: data.folder })
  const handle = runSingle(backend, { runId: `bp:model:${nodeId}:${Date.now()}`, modelRef: data.modelRef, prompt, cwd, readOnly: true, timeoutSecs: 15 * 60, effort: clampEffort(parseModelRef(data.modelRef).providerId as ProviderId, "medium") }, (line, stream) => log(set, nodeId, line, stream))
  handleRef.cancel = handle.cancel
  const res = await handle.done
  useBlueprintsStore.setState((s) => {
    const running = { ...s.running }
    delete running[nodeId]
    return { running }
  })
  addTokens(bpId, nodeId, res.tokens)
  const requests = parseModelRequests(res.text, { folder: data.folder, style: data.style })
  if (!res.ok || !requests.length) {
    store.updateNode(bpId, nodeId, { status: "failed", note: res.ok ? "no requests parsed" : (res.error ?? "failed") })
    log(set, nodeId, res.ok ? `✖ no ${MODEL_REQUESTS_HEADING} list found in the reply — tail:\n${res.text.trim().slice(-600)}` : `✖ ${res.error ?? "failed"}`)
    return false
  }
  await saveModelRequests(bpId, nodeId, cwd, requests)
  log(set, nodeId, `📋 ${requests.length} asset request(s):`)
  return markModelWaiting(bpId, nodeId, requests)
}

/** Put the box in `waiting` (no running handle: the app stays idle for updates and the resume walk is never refused). */
function markModelWaiting(bpId: string, nodeId: string, requests: ModelRequest[]): "waiting" {
  const set = useBlueprintsStore.setState
  const open = pendingSummary(requests)
  const rejected = open.filter((r) => r.status === "rejected").length
  useBlueprintsStore.getState().updateNode(bpId, nodeId, { status: "waiting", note: `${open.length} waiting${rejected ? ` · ${rejected} rejected` : ""} · ${requests.length - open.length}/${requests.length} accepted` })
  for (const r of open) log(set, nodeId, `  • ${r.name} — ${r.kind}${r.frames ? ` · ${r.frames} frames` : ""}${r.frameSize ? ` · ${r.frameSize}` : ""} · ${r.status}`)
  log(set, nodeId, "→ generate each request with an image AI (copy its prompt from the panel) and drop the sheet on this box, or: silent bp deliver \"<blueprint>\" \"<box>\" <file>")
  return "waiting"
}

/**
 * Convert each delivered request with a converter session (the bundled tool), then run the deterministic validator
 * on the disk. Accepted or rejected with reasons; the box returns to `waiting` afterwards (resume is a separate step).
 */
async function convertAndValidate(bpId: string, nodeId: string, reqIds: string[]): Promise<void> {
  try {
    await convertAndValidateInner(bpId, nodeId, reqIds)
  } finally {
    releaseRunning(nodeId)
  }
}

async function convertAndValidateInner(bpId: string, nodeId: string, reqIds: string[]): Promise<void> {
  const store = useBlueprintsStore.getState()
  const set = useBlueprintsStore.setState
  const bp = store.byId(bpId)
  const node = bp && nodeById(bp, nodeId)
  if (!bp || !node || node.data.type !== "model" || !reqIds.length) return
  const cwd = sourceFolder(bp, nodeId)
  if (!cwd) return
  const data = node.data
  const backend = await getBackend()
  let cancelled = false
  const cancels: Array<() => Promise<void>> = []
  useBlueprintsStore.setState((s) => ({ running: { ...s.running, [nodeId]: async () => { cancelled = true; await Promise.all(cancels.map((c) => c())) } } }))
  store.updateNode(bpId, nodeId, { status: "running", note: "converting" })
  await backend.blueprintWriteTool(cwd, DONUSTURUCU_TOOL_NAME, DONUSTURUCU_TOOL_SOURCE).catch((e) => log(set, nodeId, `⚠ converter tool not written: ${e instanceof Error ? e.message : String(e)}`))
  const current = () => {
    const b = useBlueprintsStore.getState().byId(bpId)
    const n = b && nodeById(b, nodeId)
    return n && n.data.type === "model" ? n.data.requests : data.requests
  }
  for (const reqId of reqIds) {
    if (cancelled) break
    const req = current().find((r) => r.id === reqId)
    if (!req?.delivered) continue
    store.updateNode(bpId, nodeId, { note: `converting ${req.name}` })
    const expected = expectedFiles(req)
    log(set, nodeId, `🔧 converting ${req.delivered.path} → ${req.target}/ (${req.name})`)
    let reasons: string[] = []
    let warnings: string[] = []
    let found: string[] = []
    try {
      const handle = runSingle(backend, { runId: `bp:model:${nodeId}:${req.id}:${Date.now()}`, modelRef: data.modelRef, prompt: converterBrief({ req, deliveredRel: req.delivered.path, build: cwd, expected }), cwd, timeoutSecs: 20 * 60, effort: clampEffort(parseModelRef(data.modelRef).providerId as ProviderId, "medium") }, (line, stream) => log(set, nodeId, line, stream))
      cancels.push(handle.cancel)
      const res = await handle.done
      addTokens(bpId, nodeId, res.tokens)
      if (!res.ok) reasons.push(`converter failed: ${res.error ?? "no result"}`)
      else {
        const at = res.text.toUpperCase().lastIndexOf(MODEL_DELIVERY_HEADING)
        if (at >= 0) log(set, nodeId, res.text.slice(at).trim().slice(0, 1200))
      }
    } catch (e) {
      reasons.push(`converter crashed: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!reasons.length) {
      // The validator reads the disk, never the converter's words.
      const listing = await backend.listProjectFiles(cwd, 20000).catch(() => [])
      const files = new Set(listing.map((f) => f.rel.replace(/\\/g, "/")))
      const mtimes = new Map(listing.map((f) => [f.rel.replace(/\\/g, "/"), f.mtimeMs]))
      const base = req.target.replace(/\/$/, "")
      let atlas: AtlasJson | null
      try {
        const text = await backend.readProjectFile(cwd, `${base}/${req.name}.json`, 512 * 1024)
        atlas = text ? (JSON.parse(text) as AtlasJson) : null
      } catch {
        atlas = null
      }
      const png = new Map<string, PngProbe | null>()
      const probe = async (rel: string) => {
        if (!files.has(rel)) return
        const blob = await backend.readProjectBlob(cwd, rel, 16 * 1024 * 1024).catch(() => null)
        png.set(rel, blob ? probePng(decodeBase64(blob.base64)) : null)
      }
      await probe(`${base}/${req.name}.png`)
      for (const a of req.animations ?? []) await probe(`${base}/${frameName(req.name, a.name, 0)}.png`)
      try {
        const v = validateDelivery(req, { files, atlas, png, mtimes, deliveredAt: req.delivered.at })
        reasons = v.reasons
        warnings = v.warnings
        found = v.found
      } catch (e) {
        reasons = [`validator crashed: ${e instanceof Error ? e.message : String(e)}`]
      }
    }
    const ok = !reasons.length
    for (const r of reasons) log(set, nodeId, `  ✗ ${r}`, "stderr")
    for (const w of warnings) log(set, nodeId, `  ⚠ ${w}`)
    log(set, nodeId, ok ? `✓ ${req.name} accepted (${expected.length} files verified)` : `✗ ${req.name} rejected — fix the sheet and deliver again (or force-accept from the panel)`)
    const requests = current().map((r) => (r.id === reqId ? { ...r, status: ok ? ("accepted" as const) : ("rejected" as const), reasons: ok ? undefined : reasons, outputs: ok ? found : undefined } : r))
    await saveModelRequests(bpId, nodeId, cwd, requests)
  }
  useBlueprintsStore.setState((s) => {
    const running = { ...s.running }
    delete running[nodeId]
    return { running }
  })
  const requests = current()
  if (!requests.every((r) => r.status === "accepted")) markModelWaiting(bpId, nodeId, requests)
}

/** Every request accepted (or a non-strict "continue"): write the manifest, go green, and walk on from the box. */
async function maybeResumeModel(bpId: string, nodeId: string, partial = false): Promise<void> {
  const store = useBlueprintsStore.getState()
  const set = useBlueprintsStore.setState
  const bp = store.byId(bpId)
  const node = bp && nodeById(bp, nodeId)
  if (!bp || !node || node.data.type !== "model") return
  const cwd = sourceFolder(bp, nodeId)
  if (!cwd) return
  const requests = node.data.requests
  const complete = requests.length > 0 && requests.every((r) => r.status === "accepted")
  if (!complete && !partial) return
  const backend = await getBackend()
  const report = modelManifest(requests)
  await backend.writeProjectFile(cwd, MODEL_DOC_REL, modelDoc(requests, node.data.folder)).catch(() => undefined)
  patchModel(bpId, nodeId, { report, lastOk: true }, { status: "done", note: complete ? undefined : `${requests.filter((r) => r.status !== "accepted").length} unresolved (continued)` })
  const build = incoming(bp, nodeId).find((n) => n.type === "build" || n.type === "buildPhoto")
  if (build) void store.refreshBuild(bpId, build.id).catch(() => undefined)
  log(set, nodeId, complete ? `✓ all ${requests.length} asset(s) accepted — ${MODEL_DOC_REL} written, the chain resumes` : "→ continuing with a partial contract (strict off)")
  void store.run(bpId, nodeId).catch((e) => reportError(e instanceof Error ? e.message : String(e)))
}

type ExecAiOpts = { purpose?: string; extraPrompt?: string; resume?: boolean; parallel?: boolean; /** Görev aktarımı: run on this model instead of the box's own (the box keeps its setting). */ modelRef?: string }

async function execAi(bpId: string, aiId: string, opts?: ExecAiOpts): Promise<boolean> {
  // Re-entry guard: a box that is running (any chain) is never started a second time (2026-10-05: the fixer loop
  // re-entered a running Eylem, replaced its cancel handle and released the box while the first session still ran).
  if (useBlueprintsStore.getState().running[aiId]) {
    log(useBlueprintsStore.setState, aiId, "⚠ already running — not started a second time")
    return false
  }
  // Reserve BEFORE the first await (backend, build dir, repo sync, digest): a double Enter in that window used to start two runs.
  useBlueprintsStore.setState((s) => ({ running: { ...s.running, [aiId]: () => undefined } }))
  try {
    return await execAiInner(bpId, aiId, opts)
  } finally {
    releaseRunning(aiId)
  }
}

async function execAiInner(bpId: string, aiId: string, opts?: ExecAiOpts): Promise<boolean> {
  const store = useBlueprintsStore.getState()
  const set = useBlueprintsStore.setState
  let bp = store.byId(bpId)
  const ai = bp && nodeById(bp, aiId)
  if (!bp || !ai || ai.data.type !== "ai") return false
  const mainRef = opts?.modelRef || ai.data.modelRef || ai.data.pool?.[0] || ""
  const dosage = dosageWeights(useSettingsStore.getState().settings)
  const poolRefs = Array.from(new Set([mainRef, ...orderByDosage(ai.data.pool ?? [], dosage)].filter(Boolean)))
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
    // Denetçi: only a RED check is a work order (a green one has nothing to fix).
    if (n.data.type === "check") return n.data.report?.trim() && n.data.lastOk === false ? [{ title: n.data.title || "Denetçi", report: n.data.report, kind: "check" }] : []
    // Çoklu Tarayıcı: only lanes with findings are a work order.
    if (n.data.type === "verify") return n.data.report?.trim() && n.data.lastOk === false ? [{ title: n.data.title || "Çoklu Tarayıcı", report: n.data.report, kind: "verify" }] : []
    // Model Plus: the validated asset manifest (only once the contract is complete).
    if (n.data.type === "model") return n.data.report?.trim() && n.data.lastOk === true ? [{ title: n.data.title || "Model Plus", report: n.data.report, kind: "model" }] : []
    if (n.data.type !== "ai" || !n.data.report?.trim()) return []
    if (n.data.role === "bilinc" && role === "eylem") return [{ title: n.data.title || n.id, report: n.data.report, kind: "bilinc" }]
    if (n.data.role === "kesifci") return [{ title: n.data.title || n.id, report: n.data.report, kind: "kesifci" }]
    if (n.data.role === "donusturucu") return [{ title: n.data.title || n.id, report: n.data.report, kind: "donusturucu" }]
    return []
  })
  const purpose = effectivePurpose(role, ai.data.purpose, opts?.purpose)
  // A Dikiş (stitch) box needs no wired prompt: its task is its policy (2026-10-01: the chain stopped on "no prompt").
  const task = aiTaskText({ purpose, wired, extraPrompt: opts?.extraPrompt, reports }) || defaultTaskForRole(role)
  if (!task && !fills.length) {
    store.updateNode(bpId, aiId, { status: "failed", note: "no prompt" })
    log(set, aiId, "⚠ wire a prompt into this AI")
    return false
  }
  // Working folder: wired build (develop) or a new build folder named after the prompt.
  let outBuild = firstOutgoing(bp, aiId, "build")
  if (isOrchestration(ai.data.mode) && !opts?.parallel) {
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
    else if (role !== "bilinc" && role !== "donusturucu" && role !== "kesifci") {
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
  // Kaşe: an existing project's digest so a single session edits instead of re-discovering (orchestrations get it through the executor context).
  const digest = buildFolders[0] && !isOrchestration(ai.data.mode) ? await backend.repoDigest(cwd, 10 * 1024).catch(() => "") : ""
  const prompt = buildAiPrompt({ purpose, wired, extraPrompt: opts?.extraPrompt, instructions: ai.data.instructions, existingProjectAt: buildFolders[0] ? cwd : undefined, digest, refPaths, stubs, fills, converterTool: converterTool && ai.data.mode !== "orchestration", imageTool: Boolean(providerInfo(parseModelRef(mainRef).providerId as ProviderId).capabilities.image), role, reports })
  // Orchestration gets a fresh run id after planning; drop the old one so badges do not show a previous run's tokens meanwhile.
  // The box keeps its link to the previous run until the new run exists (2026-10-05: an accidental double-click cleared
  // it during planning, the re-run was cancelled, and the unfinished run could no longer be resumed).
  store.updateNode(bpId, aiId, { status: "running", note: undefined })
  // Reserve the node NOW: planning takes a minute, and a second Enter/`silent bp` in that window used to start a
  // second orchestration on the same folder (2026-09-29, two runs 12 s apart). The real cancel handle replaces this.
  useBlueprintsStore.setState((s) => ({ running: { ...s.running, [aiId]: s.running[aiId] ?? (() => undefined) } }))
  log(set, aiId, `▶ ${poolRefs.join(" + ")} · ${ai.data.mode} · ${cwd}`)

  let ok: boolean
  let used: number
  let executionId: string | undefined
  // A stored session is resumed only in its folder and on the model that produced it (2026-10-05: after a handover the
  // box held Claude's session id while its main model was Gemini).
  let sessionId: string | undefined = ai.executionId?.startsWith("session:") && (!ai.data.sessionCwd || ai.data.sessionCwd === cwd) && (!ai.data.sessionModelRef || ai.data.sessionModelRef === mainRef) ? ai.executionId.slice(8) : undefined
  /** Why the box failed, shown on the red box (2026-10-05: a bare "failed" hid a plan-limit error). */
  let failNote = "failed"
  // Bütçe: the guard wired into this box; an orchestration is cancelled live once its tokens pass the limit.
  const budget = incoming(bp, aiId).find((n) => n.data.type === "budget")
  const maxTokens = budget?.data.type === "budget" ? budget.data.maxTokens : undefined
  if (isOrchestration(ai.data.mode) && role !== "bilinc" && role !== "donusturucu" && role !== "kesifci") {
    const runs = useRunsStore.getState()
    const res = await runs.plan({ prompt, pool: poolRefs, executionMode: "staged", costMode: (ai.data.costMode ?? "balanced") as CostMode, repoPath: cwd, kitId: ai.data.kitId ?? "", polish: !ai.data.turbo && ai.data.mode !== "lite", effort: (ai.data.turbo || ai.data.mode === "lite") && ai.data.effort && (ai.data.effort === "high" || ai.data.effort === "xhigh") ? "medium" : ai.data.effort, turbo: ai.data.turbo || ai.data.mode === "lite", mechanical: ai.data.mechanical, lite: ai.data.mode === "lite" })
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
    log(set, aiId, `run ${res.run.id}: ${res.run.plan.length} tasks${maxTokens ? ` · budget ${formatTokens(maxTokens)}` : ""}`)
    const stopBudget = maxTokens && budget ? watchBudget(bpId, budget.id, res.run.id, maxTokens, (spent) => log(set, aiId, `⛔ budget: ${formatTokens(spent)} > ${formatTokens(maxTokens)} — run cancelled`)) : undefined
    const status = await waitForRun(res.run.id)
    stopBudget?.()
    ok = status === "completed"
    const final = useRunsStore.getState().byId(res.run.id)
    used = (final?.plan ?? []).reduce((n, st) => n + (st.tokens ?? 0), 0)
    if (final?.report?.polishScore !== undefined) log(set, aiId, `polish ${final.report.polishScore}/10`)
  } else {
    const keepSession = Boolean(ai.data.keepSession)
    const boxEffort = ai.data.effort
    const singlePrompt = role === "bilinc" || role === "donusturucu" || role === "kesifci" ? prompt : `${prompt}\n\nWhen done, reply with a concise summary of what you produced.`
    const startSingle = (ref: string, extra?: string) =>
      runSingle(
        backend,
        { runId: `bp:${aiId}:${Date.now()}`, modelRef: ref, prompt: extra ? `${singlePrompt}\n\n${extra}` : singlePrompt, cwd, readOnly: role === "bilinc" || role === "kesifci", resumeSessionId: !extra && (opts?.resume || keepSession) ? sessionId : undefined, effort: clampEffort(parseModelRef(ref).providerId as ProviderId, boxEffort) },
        (line, stream) => log(set, aiId, line, stream),
      )
    const { res, usedRef } = await runSingleChain({
      mainRef,
      pool: ai.data.pool ?? [],
      weights: dosage,
      fallbackRef: useSettingsStore.getState().settings.fallbackModelRef,
      start: startSingle,
      onCancel: (cancel) => useBlueprintsStore.setState((s) => ({ running: { ...s.running, [aiId]: cancel } })),
      unavailable: () => useProvidersStore.getState().unavailable,
      markUnavailable: (ref, reason) => useProvidersStore.getState().markUnavailable(ref, reason),
      log: (line) => log(set, aiId, line),
      onWait: (until) => store.updateNode(bpId, aiId, { data: { quotaWaitUntil: until } }),
    })
    ok = res.ok
    used = res.tokens
    if (maxTokens && budget && used > maxTokens) {
      // A single session reports tokens only at the end: note the overrun on the budget box (an orchestration is cut live).
      store.updateNode(bpId, budget.id, { status: "failed", note: `over by ${formatTokens(used - maxTokens)}`, data: { spent: used } })
      log(set, aiId, `⛔ budget: ${formatTokens(used)} > ${formatTokens(maxTokens)}`)
    } else if (budget) store.updateNode(bpId, budget.id, { status: "done", note: undefined, data: { spent: used } })
    if ((role === "bilinc" || role === "donusturucu" || role === "kesifci" || role === "dikis" || ai.data.tamirci) && res.text.trim()) {
      // The report (from `# FINDINGS` / `# CONVERTED` on) is what the wired next node reads; the commentary before it is dropped.
      const report = extractReport(res.text)
      store.updateNode(bpId, aiId, { data: { report } })
      log(set, aiId, `📄 report: ${report.split("\n").length} lines`)
    }
    sessionId = res.sessionId ?? sessionId
    executionId = sessionId ? `session:${sessionId}` : undefined
    if (sessionId) store.updateNode(bpId, aiId, { data: { sessionCwd: cwd, sessionModelRef: res.sessionId ? usedRef : ai.data.sessionModelRef } })
    if (!ok && res.error) failNote = res.error === "cancelled" ? "cancelled" : res.error.replace(/\s+/g, " ").slice(0, 160)
    const swept = cwd ? await backend.projectSweep(cwd).catch(() => 0) : 0
    if (swept) log(set, aiId, `🧹 swept ${swept} leftover browser/dev-server process(es)`)
    if (!ok) log(set, aiId, `✖ ${res.error ?? "failed"}`)
  }
  useBlueprintsStore.setState((s) => {
    const running = { ...s.running }
    delete running[aiId]
    return { running }
  })
  store.updateNode(bpId, aiId, { status: ok ? "done" : "failed", executionId, note: ok ? undefined : failNote })
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
    const namer = pickPlannerModel(useProvidersStore.getState().availableModels(), dosageWeights(useSettingsStore.getState().settings))
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
