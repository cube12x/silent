import * as React from "react"
import "@xyflow/react/dist/style.css"
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type NodeChange, type Edge } from "@xyflow/react"
import { useNavigate, useParams } from "react-router"
import { cn } from "cn"
import { Plus, Play, Send, Trash2, FolderOpen, Sparkles, Loader2, Maximize2, Minimize2 } from "lucide-react"
import { useBlueprintsStore, startBlueprintWatchers } from "@/stores/blueprints"
import { useProvidersStore, selectAvailableModels } from "@/stores/providers"
import { useRunsStore } from "@/stores/runs"
import { formatCountdown, formatTokens } from "@/lib/format"
import { useNow } from "@/lib/useNow"
import { rosterGlyph } from "@/engine/blueprint/roster"
import { ModelSelectorGrid } from "@/design-system/tactical/ModelSelectorGrid"
import { aiChainFrom, lintBlueprint, resolveAutorun } from "@/engine/blueprint/graph"
import { NODE_TYPES, type BpFlowNode } from "./nodes"
import { roleHint, roleLabel } from "./roles"
import { NeonButton, PageHeader } from "@/design-system"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { ModelPicker } from "@/features/chat/ModelPicker"
import { BUILTIN_KITS } from "@/domain/kits"
import { getBackend } from "@/services"
import { isTauri } from "@/services/backend"
import { isRepoUrl } from "@/engine/blueprint/prompt"
import { PROVIDERS } from "@/providers/registry"
import { modKey } from "@/lib/platform"
import { NodeTerminal } from "./NodeTerminal"
import { DOUBLE_CLICK_RUN_DELAY_MS, createClickGate } from "./clickGate"
import { FilesTab } from "./FilesTab"
import { type TerminalLine, isOrchestration, modelRef, parseModelRef, BP_STUB_KINDS, type BpNode, type BpNodeType, type ProviderId } from "@/domain"
import { STUB_KIND_LABELS } from "@/engine/blueprint/uydurma"
import { useI18nStore, useT } from "@/i18n"
import { reportError } from "@/stores/notify"

const MENU: Array<{ type: BpNodeType; data?: Record<string, unknown>; key: string }> = [
  { type: "prompt", key: "prompt" },
  { type: "ai", key: "ai" },
  { type: "ai", data: { mode: "single", instructions: "", repos: [] }, key: "aiCustom" },
  { type: "ai", data: { mode: "single", role: "bilinc" }, key: "bilinc" },
  { type: "ai", data: { mode: "single", role: "eylem" }, key: "eylem" },
  { type: "ai", data: { mode: "single", role: "donusturucu" }, key: "donusturucu" },
  { type: "ai", data: { mode: "single", role: "kesifci" }, key: "kesifci" },
  { type: "ai", data: { mode: "lite" }, key: "bolucu" },
  { type: "ai", data: { mode: "single", role: "dikis" }, key: "dikis" },
  { type: "check", key: "check" },
  { type: "queue", key: "queue" },
  { type: "snapshot", key: "snapshot" },
  { type: "verify", key: "verify" },
  { type: "budget", key: "budget" },
  { type: "model", key: "model" },
  { type: "build", key: "build" },
  { type: "buildPhoto", key: "buildPhoto" },
  { type: "button", data: { kind: "start" }, key: "button.start" },
  { type: "button", data: { kind: "send" }, key: "button.send" },
  { type: "button", data: { kind: "reload" }, key: "button.reload" },
  { type: "button", data: { kind: "parallel" }, key: "button.parallel" },
  { type: "wizard", key: "wizard" },
  { type: "variable", key: "variable" },
  { type: "stub", data: { kinds: ["image", "sprite", "sfx", "music"], folder: "assets/uydurma" }, key: "stub" },
]

function Canvas({ bpId, onNodeQuadClick, bare = false }: { bpId: string; onNodeQuadClick: (nodeId: string) => void; /** Sade tam ekran: only the canvas, no side panel (2026-10-05). */ bare?: boolean }) {
  const t = useT()
  const bp = useBlueprintsStore((s) => s.byId(bpId))
  const logs = useBlueprintsStore((s) => s.logs)
  const updateNode = useBlueprintsStore((s) => s.updateNode)
  const removeNode = useBlueprintsStore((s) => s.removeNode)
  const removeEdge = useBlueprintsStore((s) => s.removeEdge)
  const addEdge = useBlueprintsStore((s) => s.addEdge)
  const addNode = useBlueprintsStore((s) => s.addNode)
  const triggerNode = useBlueprintsStore((s) => s.trigger)
  const importFiles = useBlueprintsStore((s) => s.importFiles)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [selectedId, setSelectedId] = React.useState<string | undefined>(undefined)
  // ↪ Devret on a box selects it so the side panel shows that task's handover row.
  const focusTask = useBlueprintsStore((s) => s.focusTask)
  const [seenFocusAt, setSeenFocusAt] = React.useState(0)
  if (focusTask && focusTask.bpId === bpId && focusTask.at !== seenFocusAt) {
    // Adjust state while rendering (no effect): each new focus request selects its box once.
    setSeenFocusAt(focusTask.at)
    setSelectedId(focusTask.nodeId)
  }
  const [menu, setMenu] = React.useState<{ x: number; y: number; left: number; top: number } | null>(null)
  const [toast, setToast] = React.useState<string | null>(null)
  // Four quick clicks open the terminal/folder; a double click runs the node only when no 3rd click follows.
  const clickGate = React.useRef(createClickGate())
  const pendingRun = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  React.useEffect(() => () => clearTimeout(pendingRun.current), [])
  // Fit only when the blueprint opens with nodes; on an empty canvas React Flow would defer the fit to the first added node and zoom into it.
  const [fitOnInit] = React.useState(() => (bp?.nodes.length ?? 0) > 0)

  const lint = React.useMemo(() => (bp ? lintBlueprint(bp) : {}), [bp])
  const flowNodes = React.useMemo<BpFlowNode[]>(
    () =>
      (bp?.nodes ?? []).map((n) => ({
        id: n.id,
        type: n.type,
        position: { x: n.x, y: n.y },
        selected: n.id === selectedId,
        data: { node: n, warnings: lint[n.id] ?? [], log: logs[n.id]?.at(-1)?.text.slice(0, 40) },
      })) as BpFlowNode[],
    [bp, lint, logs, selectedId],
  )
  const runningIds = React.useMemo(() => new Set((bp?.nodes ?? []).filter((n) => n.status === "running").map((n) => n.id)), [bp])
  const flowEdges = React.useMemo<Edge[]>(() => (bp?.edges ?? []).map((e) => ({ id: e.id, source: e.from, target: e.to, animated: runningIds.has(e.from) || runningIds.has(e.to) })), [bp, runningIds])

  // First fit happens once the nodes are measured (the mount-time fit sees zero-size nodes and a half-laid-out container);
  // a container resize (side panel opening, window resize) refits until the user has panned or zoomed by hand.
  const fittedRef = React.useRef(false)
  const userMovedRef = React.useRef(false)
  const doFit = React.useCallback(() => {
    window.requestAnimationFrame(() => void fitView({ padding: 0.2, maxZoom: 1, duration: 0 }))
  }, [fitView])
  const onNodesChange = React.useCallback(
    (changes: NodeChange<BpFlowNode>[]) => {
      if (!fittedRef.current && changes.some((c) => c.type === "dimensions")) {
        fittedRef.current = true
        doFit()
      }
      for (const c of changes) {
        if (c.type === "position" && c.position) updateNode(bpId, c.id, { x: c.position.x, y: c.position.y })
        // "remove" changes are NOT handled here: React Flow also emits them from its own prop diff (a node missing from
        // the `nodes` prop for one render), and persisting those deleted two Bütçe boxes during a run (2026-10-01).
        // User deletions arrive through onNodesDelete / onEdgesDelete only.
        else if (c.type === "select") setSelectedId((cur) => (c.selected ? c.id : cur === c.id ? undefined : cur))
      }
    },
    [bpId, updateNode, doFit],
  )
  const onNodesDelete = React.useCallback((deleted: BpFlowNode[]) => { for (const n of deleted) removeNode(bpId, n.id) }, [bpId, removeNode])
  const onEdgesDelete = React.useCallback((deleted: Edge[]) => { for (const e of deleted) removeEdge(bpId, e.id) }, [bpId, removeEdge])
  const onEdgesChange = React.useCallback((): void => undefined, [])
  const onConnect = React.useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      const problem = addEdge(bpId, c.source, c.target)
      if (problem) setToast(t("bp.badWire", { reason: problem }))
    },
    [bpId, addEdge, t],
  )

  // Tauri: files dropped from the desktop onto a build node are copied into its folder. Registered once per canvas
  // mount (not per blueprint): every register/unregister cycle of Tauri's drag-drop listeners raced its own
  // registration and logged "listeners[eventId].handlerId" rejections (2026-09-28/29).
  const dropCtx = React.useRef({ bpId, importFiles, t })
  React.useEffect(() => {
    dropCtx.current = { bpId, importFiles, t }
  }, [bpId, importFiles, t])
  React.useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => void) | undefined
    let cancelled = false
    void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
      const off = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return
        const { bpId: id0, importFiles: doImport, t: tr } = dropCtx.current
        const scale = window.devicePixelRatio || 1
        const el = document.elementFromPoint(event.payload.position.x / scale, event.payload.position.y / scale)
        const nodeEl = el?.closest<HTMLElement>("[data-id]")
        const id = nodeEl?.dataset.id
        const node = id && useBlueprintsStore.getState().byId(id0)?.nodes.find((n) => n.id === id)
        if (node && node.type === "model") {
          // Model Plus: a dropped sheet is a delivery (matched to a request, converted, validated).
          void useBlueprintsStore.getState().modelDeliver(id0, node.id, event.payload.paths).then((n) => setToast(tr("bp.modelDelivered", { n })))
          return
        }
        if (!node || (node.type !== "build" && node.type !== "buildPhoto")) {
          setToast(tr("bp.dropOnBuild"))
          return
        }
        void doImport(id0, node.id, event.payload.paths).then((n) => setToast(tr("bp.imported", { n })))
      })
      // Tauri rejects an unlisten that races its own registration; the listener is gone either way.
      const safeOff = () => {
        try {
          void Promise.resolve(off()).catch(() => undefined)
        } catch {
          /* already gone */
        }
      }
      if (cancelled) safeOff()
      else unlisten = safeOff
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  React.useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  // 2026-10-05: an accidental double-click re-ran a finished orchestration box from scratch (and dropped its link to the
  // unfinished run). Anything that would re-run AI boxes which already produced work asks first.
  const [confirmRun, setConfirmRun] = React.useState<{ node: BpNode; rerun: string[]; resumable: boolean } | null>(null)
  const trigger = React.useCallback(
    (node: BpNode) => {
      const st = useBlueprintsStore.getState()
      const bp0 = st.byId(bpId)
      const isSend = node.data.type === "button" && node.data.kind === "send"
      const ran = (n: BpNode) => n.type === "ai" && (n.status === "done" || n.status === "failed") && Boolean(n.executionId || (n.data.type === "ai" && (n.data.tokens ?? 0) > 0))
      const rerun = bp0 && !isSend ? aiChainFrom(bp0, node.id).filter(ran).map((n) => (n.data.type === "ai" && n.data.title) || n.id) : []
      if (rerun.length) {
        setConfirmRun({ node, rerun, resumable: node.type === "ai" && Boolean(st.resumableRun(bpId, node.id)) })
        return
      }
      void triggerNode(bpId, node.id, { reloadDefaultPurpose: t("bp.reloadDefaultPurpose") })
    },
    [bpId, triggerNode, t],
  )

  // ⌘Z / ⇧⌘Z anywhere on the canvas screen (the pane itself never holds focus); fields keep their native undo.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return
      if ((e.target as HTMLElement | null)?.closest?.("textarea, input, select, [contenteditable]")) return
      e.preventDefault()
      const st = useBlueprintsStore.getState()
      if (e.shiftKey) st.redo(bpId)
      else st.undo(bpId)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [bpId])

  const canvasRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const el = canvasRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      if (!userMovedRef.current && fittedRef.current) doFit()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [doFit])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const inField = Boolean((e.target as HTMLElement).closest("textarea, input, select"))
    if (e.key === "Enter" && selectedId && !inField) {
      const node = bp?.nodes.find((n) => n.id === selectedId)
      if (node) {
        e.preventDefault()
        trigger(node)
      }
    }
  }

  const selected = bp?.nodes.find((n) => n.id === selectedId)
  if (!bp) return null
  return (
    <div className="relative flex h-full min-h-0 flex-1" onKeyDown={onKeyDown}>
      <div ref={canvasRef} className="relative min-h-0 flex-1" onContextMenu={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const menuH = Math.min(r.height - 8, MENU.length * 34 + 8); setMenu({ x: e.clientX, y: e.clientY, left: Math.min(e.clientX - r.left, Math.max(0, r.width - 216)), top: Math.min(e.clientY - r.top, Math.max(0, r.height - menuH)) }) }} onClick={() => menu && setMenu(null)}>
        <ReactFlow<BpFlowNode>
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES as never}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onConnect={onConnect}
          onNodeDoubleClick={(_, n) => {
            // Deferred: the 3rd click of a quad sequence cancels it, so opening a terminal never restarts a finished node.
            if (!clickGate.current.runOnDoubleClick(n.id, Date.now())) return
            clearTimeout(pendingRun.current)
            pendingRun.current = setTimeout(() => {
              pendingRun.current = undefined
              const node = useBlueprintsStore.getState().byId(bpId)?.nodes.find((x) => x.id === n.id)
              if (node) trigger(node)
            }, DOUBLE_CLICK_RUN_DELAY_MS)
          }}
          onNodeClick={(_, n) => {
            // Four quick clicks on the same node open its terminal (AI) or its folder (Build). Own counter: the
            // native click `detail` resets per pointer sequence in WebKit/automation and never reaches 4 reliably.
            const r = clickGate.current.click(n.id, Date.now())
            if (r.cancelPending) {
              clearTimeout(pendingRun.current)
              pendingRun.current = undefined
            }
            if (r.quad) onNodeQuadClick(n.id)
          }}
          onPaneClick={() => setMenu(null)}
          fitView={fitOnInit}
          onMoveStart={(e) => {
            if (e) userMovedRef.current = true
          }}
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.3}
          maxZoom={1.6}
          colorMode="dark"
          deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ style: { stroke: "var(--text-3)", strokeWidth: 1.5 } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(255,255,255,0.12)" />
        </ReactFlow>
        {bp.nodes.length > 0 && (
          <button type="button" onClick={() => void fitView({ padding: 0.2, maxZoom: 1 })} title={t("bp.fit")} aria-label={t("bp.fit")} className="absolute right-3 bottom-3 z-20 rounded-sm border border-line bg-ink-2 px-2 py-1 text-[11px] text-text-2 hover:text-text-1">⤢ {t("bp.fit")}</button>
        )}
        {bp.nodes.length === 0 && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-text-3">{t("bp.emptyCanvas")}</div>}
        {menu && (
          <div className="absolute z-30 max-h-[calc(100%-8px)] w-52 overflow-y-auto rounded-sm border border-line bg-ink-2 p-1 text-xs shadow-xl" style={{ left: menu.left, top: menu.top }}>
            {MENU.map((m) => (
              <button
                key={m.key}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-text-1 hover:bg-ink-3"
                onClick={(e) => {
                  e.stopPropagation()
                  const pos = screenToFlowPosition({ x: menu.x, y: menu.y })
                  const node = addNode(bpId, m.type, pos.x, pos.y, m.key === "aiCustom" ? { ...m.data, title: t("bp.node.aiCustom") } : m.key === "bilinc" ? { ...m.data, title: t("bp.node.bilinc") } : m.key === "eylem" ? { ...m.data, title: t("bp.node.eylem") } : m.key === "donusturucu" ? { ...m.data, title: t("bp.node.donusturucu"), purpose: t("bp.donusturucuPurposeDefault") } : m.key === "kesifci" ? { ...m.data, title: t("bp.node.kesifci") } : m.key === "dikis" ? { ...m.data, title: t("bp.node.dikis") } : m.key === "bolucu" ? { ...m.data, title: t("bp.node.bolucu") } : m.data)
                  if (node) setSelectedId(node.id)
                  setMenu(null)
                }}
              >
                <Plus className="size-3 text-text-3" />
                {t(`bp.menu.${m.key}` as never)}
              </button>
            ))}
          </div>
        )}
        {toast && <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-sm border border-line bg-ink-2 px-3 py-1.5 text-xs text-text-1">{toast}</div>}
        {confirmRun && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50" onClick={() => setConfirmRun(null)} onKeyDown={(e) => { if (e.key === "Escape") setConfirmRun(null) }}>
            <div role="dialog" aria-modal="true" className="w-[420px] rounded-md border border-line bg-ink-1 p-4 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-1 font-semibold text-text-1">{t("bp.confirmRerunTitle")}</div>
              <div className="mb-2 text-xs text-text-2">{t("bp.confirmRerunBody", { n: confirmRun.rerun.length })}</div>
              <ul className="mb-3 max-h-32 list-disc overflow-auto pl-5 text-xs text-text-3">{confirmRun.rerun.map((name) => <li key={name}>{name}</li>)}</ul>
              <div className="flex flex-wrap justify-end gap-2">
                <NeonButton size="sm" variant="outline" autoFocus onClick={() => setConfirmRun(null)}>{t("common.cancel")}</NeonButton>
                {confirmRun.resumable && <NeonButton size="sm" variant="outline" onClick={() => { const n = confirmRun.node; setConfirmRun(null); void useBlueprintsStore.getState().resumeBox(bpId, n.id) }}>↻ {t("bp.resume")}</NeonButton>}
                <NeonButton size="sm" onClick={() => { const n = confirmRun.node; setConfirmRun(null); void triggerNode(bpId, n.id, { reloadDefaultPurpose: t("bp.reloadDefaultPurpose") }) }}>{t("bp.confirmRerunGo")}</NeonButton>
              </div>
            </div>
          </div>
        )}
      </div>
      {!bare && (
      <aside className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-ink-1 p-3">
        {selected ? <NodePanel bpId={bpId} node={selected} log={logs[selected.id] ?? []} onTrigger={() => trigger(selected)} onRemove={() => { removeNode(bpId, selected.id); setSelectedId(undefined) }} /> : <div className="text-xs text-text-3">{t("bp.panelHint")}</div>}
      </aside>
      )}
    </div>
  )
}

/** Görevler + Devret (2026-10-05): every task of the box's run, live quota countdowns, and a per-task handover to a chosen model. */
function TaskHandoverList({ bpId, nodeId, runId }: { bpId: string; nodeId: string; runId: string }) {
  const t = useT()
  const run = useRunsStore((s) => s.byId(runId))
  const focus = useBlueprintsStore((s) => s.focusTask)
  const providers = useProvidersStore((s) => s.providers)
  const unavailable = useProvidersStore((s) => s.unavailable)
  const available = React.useMemo(() => new Set(selectAvailableModels(providers, unavailable).map((m) => modelRef(m.providerId, m.id))), [providers, unavailable])
  const [openId, setOpenId] = React.useState<string | undefined>(undefined)
  const [target, setTarget] = React.useState("")
  const [seenFocusAt, setSeenFocusAt] = React.useState(0)
  if (focus && focus.nodeId === nodeId && focus.at !== seenFocusAt) {
    setSeenFocusAt(focus.at)
    setOpenId(focus.subtaskId)
    setTarget("")
  }
  const waiting = (run?.plan ?? []).filter((st) => st.state === "waiting" && st.waitingUntil)
  const now = useNow(1000, waiting.length > 0 && run?.status === "running")
  if (!run) return null
  const dead = new Set(run.status === "running" ? useRunsStore.getState().deadModels(run.id) : [])
  const pool = new Set(run.modelPool)
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-line bg-ink-0 p-2 text-xs">
      <div className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("bp.tasks")} · {run.plan.filter((st) => st.state === "completed").length}/{run.plan.length}</div>
      {run.plan.map((st) => {
        const until = run.status === "running" && st.state === "waiting" && st.waitingUntil ? st.waitingUntil : 0
        const g = rosterGlyph(st.state, until || undefined)
        const canHand = st.state !== "completed"
        const open = openId === st.id
        return (
          <div key={st.id} className={cn("flex flex-col gap-1 border-t border-line/60 pt-1 first:border-t-0 first:pt-1", open && "rounded-sm bg-ink-2/60 px-1")}>
            <div className="flex items-center gap-1.5">
              <span className={cn("shrink-0", g.className)}>{g.glyph}</span>
              <span className="min-w-0 flex-1 truncate text-text-2" title={st.title}>{st.title}</span>
              {st.assignedModelId ? <span className="mono shrink-0 text-[10px] text-text-3">{st.assignedModelId.split(":")[1]}</span> : null}
              {until ? <span className="mono shrink-0 text-[11px] font-semibold text-warn tabular-nums" title={t("bp.quotaWaitTip")}>⏳ {formatCountdown(until - now)}</span> : null}
              {canHand && <button type="button" onClick={() => { setOpenId(open ? undefined : st.id); setTarget("") }} title={t("bp.devretHint")} className={cn("shrink-0 rounded-sm border px-1.5 text-[10px]", until ? "border-warn/50 text-warn" : "border-line text-text-3 hover:text-text-1")}>↪ {t("bp.devret")}</button>}
            </div>
            {open && (
              <div className="flex flex-col gap-1 pb-1">
                <div className="text-[10px] text-text-3">{t("bp.devretPick")}</div>
                <ModelPicker
                  size="xs"
                  providerId={(parseModelRef(target || st.assignedModelId || run.modelPool[0] || "codex:").providerId || "codex") as ProviderId}
                  modelId={parseModelRef(target || "").modelId}
                  onChange={(p, m) => setTarget(modelRef(p, m))}
                  allowed={(p, m) => {
                    const ref = modelRef(p, m)
                    if (st.needsBrowser && !PROVIDERS[p]?.capabilities.browser) return t("bp.noBrowser")
                    if (dead.has(ref) || !available.has(ref)) return t("bp.modelDead")
                    return true
                  }}
                  note={(p, m) => (pool.has(modelRef(p, m)) ? undefined : t("bp.outsidePool"))}
                />
                <div className="text-[10px] text-text-3">{t("bp.devretHint")}</div>
                <NeonButton size="sm" disabled={!target || target === st.assignedModelId} onClick={() => { setOpenId(undefined); void useBlueprintsStore.getState().handoverTask(bpId, nodeId, st.id, target) }}>↪ {t("bp.devretGo")}</NeonButton>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function NodePanel({ bpId, node, log, onTrigger, onRemove }: { bpId: string; node: BpNode; log: TerminalLine[]; onTrigger: () => void; onRemove: () => void }) {
  const t = useT()
  const lang = useI18nStore((s) => s.language)
  const updateNode = useBlueprintsStore((s) => s.updateNode)
  const cancel = useBlueprintsStore((s) => s.cancel)
  const answerNode = useBlueprintsStore((s) => s.answer)
  const running = useBlueprintsStore((s) => Boolean(s.running[node.id]))
  // Blocked worker questions (SILENT_QUESTION) of this node's orchestration run; the run object is a stable store reference.
  const runId = node.executionId && !node.executionId.startsWith("session:") ? node.executionId : undefined
  const run = useRunsStore((s) => (runId ? s.byId(runId) : undefined))
  const blocked = run?.plan.filter((st) => st.state === "blocked" && st.question) ?? []
  const [answerText, setAnswerText] = React.useState("")
  const providers = useProvidersStore((s) => s.providers)
  const unavailable = useProvidersStore((s) => s.unavailable)
  const models = React.useMemo(() => selectAvailableModels(providers, unavailable), [providers, unavailable])
  const patch = (data: Record<string, unknown>) => updateNode(bpId, node.id, { data })
  const [handoverOpen, setHandoverOpen] = React.useState(false)
  const [handoverRef, setHandoverRef] = React.useState("")
  const d = node.data
  const pickFolder = async () => {
    const p = await (await getBackend()).pickDirectory()
    if (p) patch({ folderPath: p })
  }
  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">{t(`bp.node.${node.type}` as never)}</div>
        <div className="flex gap-1">
          {(node.type === "ai" || node.type === "prompt" || node.type === "button" || node.type === "wizard" || node.type === "check" || node.type === "queue" || node.type === "snapshot" || node.type === "verify" || node.type === "model") && (running ? <NeonButton size="sm" variant="outline" onClick={() => void cancel(bpId, node.id)}>{t("common.cancel")}</NeonButton> : <NeonButton size="sm" onClick={onTrigger}>{node.type === "button" && d.type === "button" && d.kind === "send" ? <Send /> : <Play />}{t("bp.run")}</NeonButton>)}
          {node.type === "ai" && !running && <NeonButton size="sm" variant="outline" onClick={() => void useBlueprintsStore.getState().run(bpId, node.id, { only: true })} title={t("bp.runOnlyHint")}>{t("bp.runOnly")}</NeonButton>}
          {node.type === "ai" && !running && node.status === "failed" && run && run.status !== "running" && run.plan.some((st) => st.state === "completed") && <NeonButton size="sm" variant="outline" onClick={() => void useBlueprintsStore.getState().resumeBox(bpId, node.id)} title={t("bp.resumeHint")}>↻ {t("bp.resume")}</NeonButton>}
          {node.type === "ai" && d.type === "ai" && (running || node.status === "failed") && <NeonButton size="sm" variant="outline" onClick={() => setHandoverOpen((v) => !v)} title={t("bp.handoverHint")}>↪ {t("bp.handover")}</NeonButton>}
          <button type="button" onClick={onRemove} className="rounded-sm border border-line px-2 text-text-3 hover:text-danger" aria-label={t("common.delete")}><Trash2 className="size-3.5" /></button>
        </div>
      </div>
      {handoverOpen && d.type === "ai" && (
        <div className="flex flex-col gap-2 rounded-sm border border-line bg-ink-0 p-2 text-xs">
          <div className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("bp.handoverTarget")}</div>
          <ModelPicker providerId={(parseModelRef(handoverRef || d.modelRef || `${models[0]?.providerId ?? "codex"}:${models[0]?.id ?? ""}`).providerId || "codex") as ProviderId} modelId={parseModelRef(handoverRef || "").modelId} onChange={(p, m) => setHandoverRef(modelRef(p, m))} />
          <div className="text-[10px] text-text-3">{t("bp.handoverHint")}</div>
          <div className="flex gap-1">
            <NeonButton size="sm" disabled={!handoverRef || handoverRef === d.modelRef} onClick={() => { setHandoverOpen(false); void useBlueprintsStore.getState().handover(bpId, node.id, handoverRef) }}>↪ {t("bp.handover")}</NeonButton>
            <NeonButton size="sm" variant="outline" onClick={() => setHandoverOpen(false)}>{t("common.cancel")}</NeonButton>
          </div>
        </div>
      )}
      {d.type === "prompt" && (
        <>
          <Input value={d.title} onChange={(e) => patch({ title: e.target.value })} placeholder={t("bp.promptTitle")} />
          <Textarea value={d.text} onChange={(e) => patch({ text: e.target.value })} rows={12} placeholder={t("bp.promptPlaceholder")} className="mono text-[12px]" />
        </>
      )}
      {(d.type === "ai" || d.type === "wizard") && (
        <>
          <Input value={d.title ?? ""} onChange={(e) => patch({ title: e.target.value })} placeholder={t("bp.aiTitle")} />
          <ModelPicker providerId={(parseModelRef(d.modelRef || `${models[0]?.providerId ?? "codex"}:${models[0]?.id ?? ""}`).providerId || "codex") as ProviderId} modelId={parseModelRef(d.modelRef || "").modelId} onChange={(p, m) => patch({ modelRef: modelRef(p, m) })} />
          {d.type === "ai" && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="flex flex-col gap-1 text-text-3">{t("bp.modeLabel")}
                <select value={d.mode} onChange={(e) => patch({ mode: e.target.value })} className="rounded-sm border border-line bg-ink-2 px-1.5 py-1 text-text-1">
                  <option value="orchestration">{t("bp.mode.orchestration")}</option>
                  <option value="single">{t("bp.mode.single")}</option>
                  <option value="lite">{t("bp.mode.lite")}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-text-3">{t("code.cost")}
                <select value={d.costMode ?? "balanced"} onChange={(e) => patch({ costMode: e.target.value })} className="rounded-sm border border-line bg-ink-2 px-1.5 py-1 text-text-1">
                  {(["economy", "balanced", "max-quality"] as const).map((c) => <option key={c} value={c}>{t(`code.costModes.${c}` as const)}</option>)}
                </select>
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-text-3">{t("code.kit")}
                <select value={d.kitId ?? ""} onChange={(e) => patch({ kitId: e.target.value })} className="rounded-sm border border-line bg-ink-2 px-1.5 py-1 text-text-1">
                  <option value="">{t("code.kitAuto")}</option>
                  {BUILTIN_KITS.map((k) => <option key={k.id} value={k.id}>{k.name[lang]}</option>)}
                </select>
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-text-3">{t("bp.effort")}
                <div className="flex flex-wrap gap-1">
                  {(["auto", "low", "medium", "high", "xhigh"] as const).map((lvl) => {
                    const providers = Array.from(new Set([d.modelRef, ...(d.mode !== "single" ? d.pool ?? [] : [])].filter(Boolean).map((r) => parseModelRef(r).providerId as ProviderId)))
                    const supported = lvl === "auto" || providers.some((p) => (PROVIDERS[p]?.efforts ?? []).includes(lvl))
                    const on = (d.effort ?? "auto") === lvl
                    return (
                      <button key={lvl} type="button" disabled={!supported} onClick={() => patch({ effort: lvl === "auto" ? undefined : lvl })} title={supported ? undefined : t("bp.effortUnsupported")} className={cn("rounded-sm border px-2 py-0.5 text-[11px]", on ? "border-text-1 bg-ink-3 text-text-1" : "border-line text-text-2 hover:text-text-1", !supported && "opacity-40")}>
                        {lvl === "auto" ? t("bp.effortAuto") : lvl}
                      </button>
                    )
                  })}
                </div>
                <span className="text-[10px]">{t("bp.effortHint")}</span>
              </label>
              <label className="col-span-2 flex items-start gap-2 text-text-1">
                <input type="checkbox" checked={Boolean(d.turbo)} onChange={(e) => patch({ turbo: e.target.checked || undefined })} className="mt-0.5" />
                <span><span className="block font-medium">{t("code.turbo")}</span><span className="block text-[10px] text-text-3">{t("code.turboHint")}</span></span>
              </label>
              {d.mode !== "single" && (
                <label className="col-span-2 flex items-start gap-2 text-text-1">
                  <input type="checkbox" checked={Boolean(d.mechanical)} onChange={(e) => patch({ mechanical: e.target.checked || undefined })} className="mt-0.5" />
                  <span><span className="block font-medium">{t("code.mechanical")}</span><span className="block text-[10px] text-text-3">{t("code.mechanicalHint")}</span></span>
                </label>
              )}
              {d.mode === "single" && (
                <label className="col-span-2 flex items-start gap-2 text-text-1">
                  <input type="checkbox" checked={Boolean(d.keepSession)} onChange={(e) => patch({ keepSession: e.target.checked || undefined })} className="mt-0.5" />
                  <span><span className="block font-medium">{t("bp.keepSession")}</span><span className="block text-[10px] text-text-3">{t("bp.keepSessionHint")}</span></span>
                </label>
              )}
              {(
                <label className="col-span-2 flex flex-col gap-1 text-text-3">{d.mode === "single" ? t("bp.poolBackup") : t("bp.pool")}
                  <ModelSelectorGrid compact models={models} selected={d.pool ?? []} onToggle={(ref) => patch({ pool: (d.pool ?? []).includes(ref) ? (d.pool ?? []).filter((x) => x !== ref) : [...(d.pool ?? []), ref] })} />
                  <span className="text-[10px]">{d.mode === "single" ? t("bp.poolBackupHint") : t("bp.poolHint")}</span>
                </label>
              )}
            </div>
          )}
          <label className="flex flex-col gap-1 text-xs text-text-3">{t("bp.purpose")}
            <Textarea value={d.purpose ?? ""} onChange={(e) => patch({ purpose: e.target.value })} rows={4} placeholder={d.type === "wizard" ? t("bp.wizardPurposePlaceholder") : t("bp.aiPurposePlaceholder")} className="text-[12px]" />
          </label>
          {d.type === "ai" && d.role && (
            <div className="rounded-sm border border-line bg-ink-0 p-2 text-[11px] text-text-2">
              <div className="mb-1 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{roleLabel(d.role, t as never)}</div>
              {roleHint(d.role, t as never)}
              {(d.role === "bilinc" || d.role === "donusturucu" || d.role === "kesifci") && (
                <pre className="mono mt-2 max-h-[30vh] overflow-auto rounded-sm border border-line bg-ink-1 p-2 text-[10px] leading-4 whitespace-pre-wrap text-text-2">{d.report?.trim() || t("bp.reportEmpty")}</pre>
              )}
            </div>
          )}
          {d.type === "ai" && (
            <>
              <label className="flex flex-col gap-1 text-xs text-text-3">{t("bp.instructions")}
                <Textarea value={d.instructions ?? ""} onChange={(e) => patch({ instructions: e.target.value })} rows={4} placeholder={t("bp.instructionsPlaceholder")} className="text-[12px]" />
              </label>
              <div className="flex flex-col gap-1 text-xs text-text-3">
                <div className="flex items-center justify-between">
                  <span>{t("bp.repos")}</span>
                  <button type="button" className="text-[11px] text-text-2 hover:text-text-1" onClick={() => patch({ repos: [...(d.repos ?? []), { url: "" }] })}>+ {t("bp.reposAdd")}</button>
                </div>
                {(d.repos ?? []).map((r, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input value={r.url} onChange={(e) => patch({ repos: (d.repos ?? []).map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://github.com/owner/repo" className={cn("h-7 flex-1 text-[11px]", r.url.trim() && !isRepoUrl(r.url) && "border-danger/60")} />
                    <Input value={r.hint ?? ""} onChange={(e) => patch({ repos: (d.repos ?? []).map((x, j) => (j === i ? { ...x, hint: e.target.value } : x)) })} placeholder={t("bp.repoHint")} className="h-7 w-28 text-[11px]" />
                    <button type="button" onClick={() => patch({ repos: (d.repos ?? []).filter((_, j) => j !== i) })} className="text-text-3 hover:text-danger" aria-label={t("common.remove")}><Trash2 className="size-3" /></button>
                  </div>
                ))}
                <span className="text-[10px]">{t("bp.reposHint")}</span>
              </div>
            </>
          )}
          {run && d.type === "ai" && (d.mode === "orchestration" || d.mode === "lite") && run.plan.length > 0 && <TaskHandoverList bpId={bpId} nodeId={node.id} runId={run.id} />}
          {blocked.length > 0 && (
            <div className="flex flex-col gap-2 rounded-sm border border-warn/50 bg-warn/5 p-2 text-xs">
              <div className="text-[10px] font-semibold tracking-[0.16em] text-warn uppercase">❓ {t("bp.questions", { n: blocked.length })}</div>
              {blocked.map((st) => (
                <div key={st.id} className="text-text-2"><span className="text-text-3">{st.title}:</span> {st.question}</div>
              ))}
              <Textarea value={answerText} onChange={(e) => setAnswerText(e.target.value)} rows={3} placeholder={t("bp.answerPlaceholder")} className="text-[12px]" />
              <NeonButton size="sm" disabled={!answerText.trim()} onClick={() => { if (answerNode(bpId, node.id, answerText)) setAnswerText("") }}>{t("bp.answer")}</NeonButton>
            </div>
          )}
        </>
      )}
      {(d.type === "build" || d.type === "buildPhoto") && (
        <>
          <Input value={d.title} onChange={(e) => patch({ title: e.target.value })} placeholder={t("bp.buildTitle")} />
          <div className="flex items-center gap-2 text-xs">
            <span className="mono min-w-0 flex-1 truncate text-text-2">{d.folderPath || t("bp.buildEmpty")}</span>
            <button type="button" onClick={() => void pickFolder()} className="flex items-center gap-1 rounded-sm border border-line px-2 py-1 text-text-2 hover:text-text-1"><FolderOpen className="size-3" />{t("common.browse")}</button>
          </div>
          {d.description && <div className="text-xs text-text-2">{d.description}</div>}
          <div className="text-[11px] text-text-3">{d.fileCount ?? 0} {t("bp.files")} · {t("bp.dropHint")}</div>
        </>
      )}
      {d.type === "button" && (
        <label className="flex flex-col gap-1 text-xs text-text-3">{t("bp.buttonKind")}
          <select value={d.kind} onChange={(e) => patch({ kind: e.target.value })} className="rounded-sm border border-line bg-ink-2 px-1.5 py-1 text-text-1">
            {(["start", "send", "reload", "parallel"] as const).map((k) => <option key={k} value={k}>{t(`bp.button.${k}` as const)}</option>)}
          </select>
          <span>{t(`bp.buttonHint.${d.kind}` as const)}</span>
        </label>
      )}
      {d.type === "stub" && (
        <>
          <Input value={d.title ?? ""} onChange={(e) => patch({ title: e.target.value })} placeholder={t("bp.node.stub")} />
          <label className="flex flex-col gap-1 text-xs text-text-3">{t("bp.stubFolder")}
            <Input value={d.folder} onChange={(e) => patch({ folder: e.target.value })} placeholder="assets/uydurma" className="mono" />
          </label>
          <div className="text-xs text-text-3">{t("bp.stubKinds")}</div>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {BP_STUB_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-text-2">
                <input type="checkbox" checked={d.kinds.includes(k)} onChange={(e) => patch({ kinds: e.target.checked ? [...d.kinds, k] : d.kinds.filter((x) => x !== k) })} />
                {STUB_KIND_LABELS[k][lang]}
              </label>
            ))}
          </div>
          <span className="text-[11px] text-text-3">{t("bp.stubHint")}</span>
        </>
      )}
      {d.type === "check" && (
        <>
          <Input value={d.title ?? ""} onChange={(e) => patch({ title: e.target.value })} placeholder={t("bp.node.check")} />
          <label className="flex flex-col gap-1 text-xs text-text-3">{t("bp.checkCommands")}
            <Textarea value={d.commands.join("\n")} onChange={(e) => patch({ commands: e.target.value.split("\n") })} rows={4} placeholder={"npm run typecheck\nnpm test\nnpm run build"} className="mono text-[12px]" />
            <span className="text-[10px]">{t("bp.checkCommandsHint")}</span>
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-3">{t("bp.checkSoftCommands")}
            <Textarea value={(d.softCommands ?? []).join("\n")} onChange={(e) => patch({ softCommands: e.target.value.split("\n") })} rows={2} placeholder={"npm run e2e"} className="mono text-[12px]" />
            <span className="text-[10px]">{t("bp.checkSoftCommandsHint")}</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-text-3" title={t("bp.checkContinueOnFailHint")}>
            <input type="checkbox" checked={d.continueOnFail === true} onChange={(e) => patch({ continueOnFail: e.target.checked })} />
            {t("bp.checkContinueOnFail")}
          </label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex flex-col gap-1 text-text-3">{t("bp.checkMaxLines")}<input type="number" min={5} max={400} value={d.maxLines} onChange={(e) => patch({ maxLines: Math.max(5, Number(e.target.value) || 40) })} className="mono h-7 rounded-sm border border-line bg-ink-2 px-1.5 text-[11px] text-text-1" /></label>
            <label className="flex flex-col gap-1 text-text-3">{t("bp.checkTimeout")}<input type="number" min={1} max={120} value={Math.round(d.timeoutSecs / 60)} onChange={(e) => patch({ timeoutSecs: Math.max(60, (Number(e.target.value) || 15) * 60) })} className="mono h-7 rounded-sm border border-line bg-ink-2 px-1.5 text-[11px] text-text-1" /></label>
          </div>
          <pre className="mono max-h-[30vh] overflow-auto rounded-sm border border-line bg-ink-1 p-2 text-[10px] leading-4 whitespace-pre-wrap text-text-2">{d.report?.trim() || t("bp.reportEmpty")}</pre>
        </>
      )}
      {d.type === "queue" && (
        <>
          <Input value={d.title ?? ""} onChange={(e) => patch({ title: e.target.value })} placeholder={t("bp.node.queue")} />
          <ModelPicker providerId={(parseModelRef(d.modelRef || `${models[0]?.providerId ?? "codex"}:${models[0]?.id ?? ""}`).providerId || "codex") as ProviderId} modelId={parseModelRef(d.modelRef || "").modelId} onChange={(p, m) => patch({ modelRef: modelRef(p, m) })} />
          <div className="text-[10px] text-text-3">{t("bp.queueHint")}</div>
          <pre className="mono max-h-[30vh] overflow-auto rounded-sm border border-line bg-ink-1 p-2 text-[10px] leading-4 whitespace-pre-wrap text-text-2">{d.report?.trim() || t("bp.reportEmpty")}</pre>
        </>
      )}
      {d.type === "snapshot" && (
        <>
          <Input value={d.title ?? ""} onChange={(e) => patch({ title: e.target.value })} placeholder={t("bp.node.snapshot")} />
          <div className="text-[10px] text-text-3">{t("bp.snapshotHint")}</div>
          <div className="mono text-[11px] text-text-2">{d.ref ? `${d.ref} · ${d.takenAt ? new Date(d.takenAt).toLocaleString() : ""} · ${d.folder ?? ""}` : t("bp.snapshotNone")}</div>
          {d.ref && !running && <NeonButton size="sm" variant="outline" onClick={() => void useBlueprintsStore.getState().restoreSnapshot(bpId, node.id)}>{t("bp.snapshotRestore")}</NeonButton>}
        </>
      )}
      {d.type === "verify" && (
        <>
          <Input value={d.title ?? ""} onChange={(e) => patch({ title: e.target.value })} placeholder={t("bp.node.verify")} />
          <ModelPicker providerId={(parseModelRef(d.modelRef || `${models[0]?.providerId ?? "codex"}:${models[0]?.id ?? ""}`).providerId || "codex") as ProviderId} modelId={parseModelRef(d.modelRef || "").modelId} onChange={(p, m) => patch({ modelRef: modelRef(p, m) })} />
          <label className="flex flex-col gap-1 text-xs text-text-3">{t("bp.verifyLanes")}
            <Textarea value={d.lanes.join("\n")} onChange={(e) => patch({ lanes: e.target.value.split("\n") })} rows={5} placeholder={t("bp.verifyLanesPlaceholder")} className="mono text-[12px]" />
            <span className="text-[10px]">{t("bp.verifyLanesHint")}</span>
          </label>
          <pre className="mono max-h-[30vh] overflow-auto rounded-sm border border-line bg-ink-1 p-2 text-[10px] leading-4 whitespace-pre-wrap text-text-2">{d.report?.trim() || t("bp.reportEmpty")}</pre>
        </>
      )}
      {d.type === "model" && (
        <>
          <Input value={d.title ?? ""} onChange={(e) => patch({ title: e.target.value })} placeholder={t("bp.node.model")} />
          <ModelPicker providerId={(parseModelRef(d.modelRef || `${models[0]?.providerId ?? "codex"}:${models[0]?.id ?? ""}`).providerId || "codex") as ProviderId} modelId={parseModelRef(d.modelRef || "").modelId} onChange={(p, m) => patch({ modelRef: modelRef(p, m) })} />
          <label className="flex flex-col gap-1 text-xs text-text-3">{t("bp.modelStyle")}
            <Textarea value={d.style ?? ""} onChange={(e) => patch({ style: e.target.value })} rows={2} placeholder={t("bp.modelStylePlaceholder")} className="text-[12px]" />
          </label>
          <label className="flex items-start gap-2 text-xs text-text-3">
            <input type="checkbox" checked={d.strict !== false} onChange={(e) => patch({ strict: e.target.checked })} className="mt-0.5" />
            <span>{t("bp.modelStrict")}<br /><span className="text-[10px]">{t("bp.modelStrictHint")}</span></span>
          </label>
          <div className="text-[10px] text-text-3">{t("bp.modelHint")}</div>
          <div className="flex flex-col gap-1 rounded-sm border border-line bg-ink-0 p-2 text-xs">
            <div className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("bp.modelRequests")} · {d.requests.filter((r) => r.status === "accepted").length}/{d.requests.length}</div>
            {!d.requests.length && <div className="text-[10px] text-text-3">{t("bp.modelRequestsEmpty")}</div>}
            {d.requests.map((r) => {
              const frames = (r.animations ?? []).reduce((n, a) => n + a.frames, 0)
              const others = d.requests.filter((o) => o.id !== r.id && o.status !== "accepted")
              return (
                <div key={r.id} className="flex flex-col gap-0.5 border-t border-line/60 pt-1 first:border-t-0 first:pt-0">
                  <div className="flex items-center gap-1">
                    <span className={cn("mono text-[11px]", r.status === "accepted" ? "text-success" : r.status === "rejected" ? "text-danger" : r.status === "delivered" ? "text-text-1" : "text-warn")}>{r.status === "accepted" ? "✓" : r.status === "rejected" ? "✗" : r.status === "delivered" ? "…" : "⏸"} {r.name}</span>
                    <span className="mono truncate text-[10px] text-text-3">{r.kind}{frames ? ` · ${frames} ${t("bp.modelFrames")}` : ""}{r.frameSize ? ` · ${r.frameSize}` : ""} · {t(`bp.modelStatus.${r.status}` as never)}</span>
                  </div>
                  {r.animations?.length ? <div className="mono text-[10px] text-text-3">{r.animations.map((a) => `${a.name}×${a.frames}`).join(" · ")}</div> : null}
                  <div className="flex flex-wrap gap-1">
                    <NeonButton size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(r.sheetPrompt); }} title={r.sheetPrompt.slice(0, 200)}>{t("bp.modelCopyPrompt")}</NeonButton>
                    {r.status === "rejected" && !running && <NeonButton size="sm" variant="outline" onClick={() => void useBlueprintsStore.getState().modelForceAccept(bpId, node.id, r.id)}>{t("bp.modelForceAccept")}</NeonButton>}
                    {r.delivered && others.length > 0 && !running && (
                      <select className="h-6 rounded-sm border border-line bg-ink-2 px-1 text-[10px] text-text-2" value="" onChange={(e) => { if (e.target.value) void useBlueprintsStore.getState().modelReassign(bpId, node.id, r.id, e.target.value) }}>
                        <option value="">{t("bp.modelAssign")}</option>
                        {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    )}
                  </div>
                  {r.delivered && <div className="mono truncate text-[10px] text-text-3">{r.delivered.path}</div>}
                  {r.reasons?.length ? <div className="text-[10px] text-danger">{t("bp.modelReasons")}: {r.reasons.join("; ")}</div> : null}
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-1">
            {!running && d.requests.length > 0 && <NeonButton size="sm" variant="outline" onClick={() => void (async () => { const paths = await (await getBackend()).pickFiles(); if (paths.length) await useBlueprintsStore.getState().modelDeliver(bpId, node.id, paths) })()}>{t("bp.modelAddFiles")}</NeonButton>}
            {!running && <NeonButton size="sm" variant="outline" onClick={() => void useBlueprintsStore.getState().modelRelist(bpId, node.id)}>{t("bp.modelRelist")}</NeonButton>}
            {!running && d.strict === false && d.requests.some((r) => r.status === "accepted") && node.status !== "done" && <NeonButton size="sm" variant="outline" onClick={() => void useBlueprintsStore.getState().modelContinue(bpId, node.id)}>{t("bp.modelContinue")}</NeonButton>}
          </div>
          <pre className="mono max-h-[24vh] overflow-auto rounded-sm border border-line bg-ink-1 p-2 text-[10px] leading-4 whitespace-pre-wrap text-text-2">{d.report?.trim() || t("bp.reportEmpty")}</pre>
        </>
      )}
      {d.type === "budget" && (
        <>
          <Input value={d.title ?? ""} onChange={(e) => patch({ title: e.target.value })} placeholder={t("bp.node.budget")} />
          <label className="flex flex-col gap-1 text-xs text-text-3">{t("bp.budgetMax")}
            <input type="number" min={1000} step={10000} value={d.maxTokens} onChange={(e) => patch({ maxTokens: Math.max(1000, Number(e.target.value) || 200000) })} className="mono h-7 rounded-sm border border-line bg-ink-2 px-1.5 text-[11px] text-text-1" />
            <span className="text-[10px]">{t("bp.budgetHint")}</span>
          </label>
        </>
      )}
      {d.type === "variable" && (
        <label className="flex flex-col gap-1 text-xs text-text-3">{t("bp.variableFilter")}
          <Input value={d.filter ?? ""} onChange={(e) => patch({ filter: e.target.value })} placeholder="*.png" className="mono" />
          <span>{t("bp.variableHint")}</span>
        </label>
      )}
      {node.note && <div className="rounded-sm border border-danger/40 px-2 py-1 text-[11px] text-danger">{node.note}</div>}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase"><Sparkles className="size-3" />{t("bp.log")}</div>
        <pre className={cn("mono max-h-[40vh] flex-1 overflow-auto rounded-sm border border-line bg-ink-0 p-2 text-[10px] leading-4 whitespace-pre-wrap text-text-2", !log.length && "text-text-3")}>{log.length ? log.slice(-80).map((l) => l.text).join("\n") : t("bp.logEmpty")}</pre>
      </div>
    </>
  )
}

export function BlueprintScreen() {
  const t = useT()
  const { bpId } = useParams()
  const navigate = useNavigate()
  const blueprints = useBlueprintsStore((s) => s.blueprints)
  const activeId = useBlueprintsStore((s) => s.activeId)
  const load = useBlueprintsStore((s) => s.load)
  const create = useBlueprintsStore((s) => s.create)
  const rename = useBlueprintsStore((s) => s.rename)
  const remove = useBlueprintsStore((s) => s.remove)
  const setActive = useBlueprintsStore((s) => s.setActive)
  const autorun = useBlueprintsStore((s) => s.autorun)
  const autoCreate = useBlueprintsStore((s) => s.autoCreate)
  const autoEdit = useBlueprintsStore((s) => s.autoEdit)
  const autoStatus = useBlueprintsStore((s) => s.autoStatus)
  const autoSummary = useBlueprintsStore((s) => s.autoSummary)
  const [full, setFull] = React.useState(false)
  const [terminalNode, setTerminalNode] = React.useState<string | undefined>(undefined)
  const [view, setView] = React.useState<"canvas" | "files">("canvas")
  const [pendingFix, setPendingFix] = React.useState<{ problem: string; files: string[] } | null>(null)
  const terminalOpen = React.useRef(false)
  React.useEffect(() => {
    terminalOpen.current = Boolean(terminalNode)
  }, [terminalNode])
  // Fullscreen: the canvas covers the whole window (sidebar/top bar hidden) and, in Tauri, the OS window goes fullscreen too. Esc leaves.
  React.useEffect(() => {
    if (isTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(full)).catch(() => undefined)
    if (!full) return
    const onKey = (e: KeyboardEvent) => {
      // Esc closes an open node terminal first (the Sheet handles that itself); the next Esc leaves fullscreen.
      if (e.key === "Escape" && !terminalOpen.current) setFull(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [full])
  const [autoOpen, setAutoOpen] = React.useState(false)
  const [autoText, setAutoText] = React.useState("")
  const [autoError, setAutoError] = React.useState<string | null>(null)
  const runAuto = async (mode: "create" | "edit") => {
    if (!autoText.trim() || autoStatus) return
    setAutoError(null)
    try {
      if (mode === "edit" && bp) {
        await autoEdit(bp.id, autoText.trim())
        setAutoOpen(false)
        setAutoText("")
        return
      }
      const created = await autoCreate(autoText.trim())
      setAutoOpen(false)
      setAutoText("")
      navigate(`/blueprint/${created.id}`)
    } catch (err) {
      setAutoError(err instanceof Error ? err.message : String(err))
    }
  }
  const [loaded, setLoaded] = React.useState(false)
  const id = bpId ?? activeId

  React.useEffect(() => {
    void load().then(() => setLoaded(true))
    startBlueprintWatchers()
  }, [load])
  React.useEffect(() => {
    if (id && id !== activeId) setActive(id)
  }, [id, activeId, setActive])
  // `silent bp "<blueprint>" ["<node>"]` from the terminal (AppShell routed autostart.json here).
  React.useEffect(() => {
    if (!loaded || !autorun) return
    useBlueprintsStore.setState({ autorun: undefined })
    if (autorun.auto) {
      void useBlueprintsStore
        .getState()
        .autoCreate(autorun.auto)
        .then((created) => navigate(`/blueprint/${created.id}`))
        .catch((err: unknown) => console.warn("[autostart] auto blueprint failed", err instanceof Error ? err.message : String(err)))
      return
    }
    if (autorun.fix) {
      void (async () => {
        await useBlueprintsStore.getState().load()
        const all = useBlueprintsStore.getState().blueprints
        const target = all.find((b) => b.id === autorun.ref) ?? all.find((b) => b.name.toLowerCase() === autorun.ref.toLowerCase())
        if (!target) return console.warn("[autostart] blueprint not found for fix", autorun.ref)
        navigate(`/blueprint/${target.id}`)
        setView("files")
        if (autorun.fix!.run) {
          // `silent bp fix … --run`: start the repair now, with the saved Tamirci preset (or Sonnet), on the first Build box.
          const build = target.nodes.find((n) => n.data.type === "build" && n.data.folderPath)
          if (!build) return console.warn("[autostart] fix --run: no build box with a folder", target.id)
          const preset = target.meta?.tamirci ?? { modelRef: "claude:sonnet" }
          console.warn("[autostart] fix --run", target.id, build.id)
          await useBlueprintsStore.getState().callTamirci(target.id, build.id, { problem: autorun.fix!.problem, files: autorun.fix!.files, bilinc: false, preset })
          return
        }
        setPendingFix(autorun.fix!)
      })().catch((err: unknown) => console.warn("[autostart] blueprint fix failed", err instanceof Error ? err.message : String(err)))
      return
    }
    if (autorun.edit) {
      void (async () => {
        await useBlueprintsStore.getState().load()
        const target = resolveAutorun(useBlueprintsStore.getState().blueprints, autorun)
        if (!target) return console.warn("[autostart] blueprint not found for edit", autorun.ref)
        navigate(`/blueprint/${target.bp.id}`)
        await useBlueprintsStore.getState().autoEdit(target.bp.id, autorun.edit!)
      })().catch((err: unknown) => console.warn("[autostart] blueprint edit failed", err instanceof Error ? err.message : String(err)))
      return
    }
    void (async () => {
      // Re-read the DB first: the request may reference a blueprint written by a script after this screen mounted.
      await useBlueprintsStore.getState().load()
      const st = useBlueprintsStore.getState()
      const target = resolveAutorun(st.blueprints, autorun)
      if (!target) {
        console.warn("[autostart] blueprint node not found", JSON.stringify(autorun))
        return
      }
      navigate(`/blueprint/${target.bp.id}`)
      if (autorun.handover) {
        // A single-mode box (no task given): hand the whole box over and let the chain continue after it (2026-10-06).
        if (!autorun.handover.task.trim() || (target.node.data.type === "ai" && !isOrchestration(target.node.data.mode))) {
          console.warn("[autostart] box handover", target.bp.id, target.node.id, autorun.handover.to)
          void st.handover(target.bp.id, target.node.id, autorun.handover.to, { chain: true })
          return
        }
        const run = target.node.executionId ? useRunsStore.getState().byId(target.node.executionId) : undefined
        const want = autorun.handover.task.trim().toLowerCase()
        const task = run?.plan.find((st) => st.id === autorun.handover!.task || st.title.trim().toLowerCase() === want) ?? run?.plan.find((st) => st.title.toLowerCase().includes(want))
        if (!task) {
          console.warn("[autostart] handover: task not found", autorun.handover.task)
          return
        }
        console.warn("[autostart] handover", target.bp.id, target.node.id, task.id, autorun.handover.to)
        void st.handoverTask(target.bp.id, target.node.id, task.id, autorun.handover.to)
        return
      }
      if (autorun.resume) {
        console.warn("[autostart] blueprint resume", target.bp.id, target.node.id)
        void st.resumeBox(target.bp.id, target.node.id)
        return
      }
      if (autorun.deliver) {
        const n = await st.modelDeliver(target.bp.id, target.node.id, autorun.deliver.paths, autorun.deliver.for)
        console.warn("[autostart] model deliver", target.bp.id, target.node.id, `${n} file(s)`)
        return
      }
      if (autorun.answer) {
        const n = st.answer(target.bp.id, target.node.id, autorun.answer)
        console.warn("[autostart] blueprint answer", target.bp.id, target.node.id, `${n} question(s)`)
        return
      }
      console.warn("[autostart] blueprint trigger", target.bp.id, target.node.id)
      void st.trigger(target.bp.id, target.node.id, { reloadDefaultPurpose: t("bp.reloadDefaultPurpose"), only: autorun.only })
    })()
  }, [loaded, autorun, navigate, t])

  const bp = blueprints.find((b) => b.id === id)
  // ⌘⇧F / Ctrl+Shift+F toggles the bare fullscreen canvas from anywhere on the screen (2026-10-05).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f" && bp) {
        e.preventDefault()
        setFull((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [bp])
  // Σ tokens: persisted per AI node + live subtask tokens of orchestration runs in flight (number selector).
  const liveTokens = useRunsStore((s) => (bp ? bp.nodes.reduce((acc, n) => acc + (n.status === "running" && n.executionId && !n.executionId.startsWith("session:") ? (s.byId(n.executionId)?.plan ?? []).reduce((a, st) => a + (st.tokens ?? 0), 0) : 0), 0) : 0))
  const totalTokens = (bp?.nodes.reduce((acc, n) => acc + (n.data.type === "ai" || n.data.type === "verify" || n.data.type === "model" ? (n.data.tokens ?? 0) : 0), 0) ?? 0) + liveTokens
  const newBlueprint = async () => {
    const created = await create(t("bp.newName", { n: blueprints.length + 1 }))
    navigate(`/blueprint/${created.id}`)
  }
  return (
    <div className={cn("flex h-full min-h-0 flex-col", full && "fixed inset-0 z-50 bg-ink-0")}>
      {full && bp && (
        // Sade tam ekran: nothing but the canvas; a small floating exit (Esc works too).
        <div className="pointer-events-none absolute top-2 right-3 z-[60] flex items-center gap-2">
          <span className="mono pointer-events-auto rounded-sm border border-line bg-ink-1/90 px-2 py-0.5 text-[11px] text-text-3">{bp.name} · {t("bp.totalTokens", { n: formatTokens(totalTokens) })}</span>
          <button type="button" onClick={() => setFull(false)} title={`${t("bp.exitFullscreen")} (Esc)`} aria-label={t("bp.exitFullscreen")} className="pointer-events-auto flex items-center gap-1 rounded-sm border border-line bg-ink-1/90 px-2 py-1 text-xs text-text-2 hover:text-text-1 [&_svg]:size-3.5"><Minimize2 />Esc</button>
        </div>
      )}
      {!full && (
      <div className="flex min-w-0 items-center gap-3 overflow-hidden border-b border-line px-4 py-2 [&>*]:shrink-0">
        <PageHeader eyebrow={t("bp.title")} title="" description="" className="mb-0" />
        {bp && (
          <div className="flex rounded-sm border border-line text-[11px]">
            <button type="button" onClick={() => setView("canvas")} className={cn("px-2 py-1", view === "canvas" ? "bg-ink-3 text-text-1" : "text-text-3 hover:text-text-1")}>{t("files.canvasTab")}</button>
            <button type="button" onClick={() => setView("files")} className={cn("px-2 py-1", view === "files" ? "bg-ink-3 text-text-1" : "text-text-3 hover:text-text-1")}>{t("files.tab")}</button>
          </div>
        )}
        <select value={id ?? ""} onChange={(e) => navigate(`/blueprint/${e.target.value}`)} className="max-w-[260px] truncate rounded-sm border border-line bg-ink-2 px-2 py-1 text-xs text-text-1">
          {!id && <option value="">—</option>}
          {blueprints.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {bp && <Input value={bp.name} onChange={(e) => void rename(bp.id, e.target.value)} className="h-7 w-48 text-xs" />}
        <NeonButton size="sm" onClick={() => void newBlueprint()}><Plus />{t("bp.new")}</NeonButton>
        <NeonButton size="sm" variant="outline" onClick={() => setAutoOpen((v) => !v)} disabled={Boolean(autoStatus)}><Sparkles />{autoStatus ? t("bp.autoWorking") : t("bp.auto")}</NeonButton>
        {bp && <button type="button" onClick={() => { void remove(bp.id); navigate("/blueprint") }} className="ml-auto rounded-sm border border-line px-2 py-1 text-xs text-text-3 hover:text-danger">{t("common.delete")}</button>}
        {bp && <span className="mono shrink-0 rounded-sm border border-line px-2 py-0.5 text-[11px] whitespace-nowrap text-text-2" title={t("bp.tokensHint")}>{t("bp.totalTokens", { n: formatTokens(totalTokens) })}</span>}
        {bp && <button type="button" onClick={() => setFull((v) => !v)} title={full ? t("bp.exitFullscreen") : t("bp.fullscreen")} aria-label={full ? t("bp.exitFullscreen") : t("bp.fullscreen")} className="flex shrink-0 items-center gap-1 rounded-sm border border-line px-2 py-1 text-xs text-text-2 hover:text-text-1 [&_svg]:size-3.5">{full ? <Minimize2 /> : <Maximize2 />}{full ? t("bp.exitFullscreen") : t("bp.fullscreen")}</button>}
        {/* 2026-10-05: in a narrow window this hint wrapped word by word into a tall column and pushed the canvas half off
            the screen ("huge black columns"). It now takes the leftover width on one line and truncates. */}
        <span className="min-w-0 !shrink truncate text-[11px] whitespace-nowrap text-text-3" title={t("bp.hint", { mod: modKey() })}>{t("bp.hint", { mod: modKey() })}</span>
      </div>
      )}
      {!full && autoOpen && (
        <div className="flex flex-col gap-2 border-b border-line bg-ink-1 px-4 py-3">
          <div className="text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">{t("bp.auto")}</div>
          <Textarea value={autoText} onChange={(e) => setAutoText(e.target.value)} rows={4} placeholder={t("bp.autoPlaceholder")} className="text-[12px]" disabled={Boolean(autoStatus)} />
          <div className="flex items-center gap-3">
            {bp && <NeonButton size="sm" onClick={() => void runAuto("edit")} disabled={!autoText.trim() || Boolean(autoStatus)}>{autoStatus ? <Loader2 className="animate-spin" /> : <Sparkles />}{autoStatus ? t("bp.autoWorking") : t("bp.autoEdit")}</NeonButton>}
            <NeonButton size="sm" variant={bp ? "outline" : "default"} onClick={() => void runAuto("create")} disabled={!autoText.trim() || Boolean(autoStatus)}>{!bp && autoStatus ? <Loader2 className="animate-spin" /> : <Plus />}{bp ? t("bp.autoCreateNew") : autoStatus ? t("bp.autoWorking") : t("bp.autoRun")}</NeonButton>
            <span className="mono text-[11px] text-text-3">{autoStatus ?? t("bp.autoHint")}</span>
            {autoError && <span className="text-[11px] text-danger">{autoError}</span>}
          </div>
        </div>
      )}
      {!full && autoSummary && bp && <div className="border-b border-line bg-ink-1 px-4 py-2 text-[11px] text-text-2">{autoSummary}</div>}
      {bp && view === "files" ? (
        <FilesTab bp={bp} initialFix={pendingFix} onFixConsumed={() => setPendingFix(null)} />
      ) : bp ? (
        <ReactFlowProvider>
          <Canvas
            key={bp.id}
            bpId={bp.id}
            bare={full}
            onNodeQuadClick={(id) => {
              const node = bp.nodes.find((n) => n.id === id)
              if (node && (node.data.type === "build" || node.data.type === "buildPhoto")) {
                const folder = node.data.folderPath
                if (folder) void getBackend().then((b) => b.openPath(folder)).catch((e) => reportError(e, "open folder"))
                return
              }
              setTerminalNode((cur) => (cur === id ? undefined : id))
            }}
          />
          <NodeTerminal bpId={bp.id} nodeId={terminalNode} onClose={() => setTerminalNode(undefined)} />
        </ReactFlowProvider>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-text-3">{loaded ? t("bp.none") : t("common.loading")}</div>
      )}
    </div>
  )
}
