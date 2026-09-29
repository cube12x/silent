import * as React from "react"
import "@xyflow/react/dist/style.css"
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type EdgeChange, type NodeChange, type Edge } from "@xyflow/react"
import { useNavigate, useParams } from "react-router"
import { cn } from "cn"
import { Plus, Play, Send, Trash2, FolderOpen, Sparkles, Loader2, Maximize2, Minimize2 } from "lucide-react"
import { useBlueprintsStore, startBlueprintWatchers } from "@/stores/blueprints"
import { useProvidersStore, selectAvailableModels } from "@/stores/providers"
import { useRunsStore } from "@/stores/runs"
import { formatTokens } from "@/lib/format"
import { ModelSelectorGrid } from "@/design-system/tactical/ModelSelectorGrid"
import { lintBlueprint, resolveAutorun } from "@/engine/blueprint/graph"
import { NODE_TYPES, type BpFlowNode } from "./nodes"
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
import { type TerminalLine, modelRef, parseModelRef, BP_STUB_KINDS, type BpNode, type BpNodeType, type ProviderId } from "@/domain"
import { STUB_KIND_LABELS } from "@/engine/blueprint/uydurma"
import { useI18nStore, useT } from "@/i18n"

const MENU: Array<{ type: BpNodeType; data?: Record<string, unknown>; key: string }> = [
  { type: "prompt", key: "prompt" },
  { type: "ai", key: "ai" },
  { type: "ai", data: { mode: "single", instructions: "", repos: [] }, key: "aiCustom" },
  { type: "ai", data: { mode: "single", role: "bilinc" }, key: "bilinc" },
  { type: "ai", data: { mode: "single", role: "eylem" }, key: "eylem" },
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

function Canvas({ bpId, onNodeQuadClick }: { bpId: string; onNodeQuadClick: (nodeId: string) => void }) {
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
  const [menu, setMenu] = React.useState<{ x: number; y: number; left: number; top: number } | null>(null)
  const [toast, setToast] = React.useState<string | null>(null)
  const quadClick = React.useRef({ id: "", n: 0, at: 0 })
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
        else if (c.type === "remove") removeNode(bpId, c.id)
        else if (c.type === "select") setSelectedId((cur) => (c.selected ? c.id : cur === c.id ? undefined : cur))
      }
    },
    [bpId, updateNode, removeNode, doFit],
  )
  const onEdgesChange = React.useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) if (c.type === "remove") removeEdge(bpId, c.id)
    },
    [bpId, removeEdge],
  )
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

  const trigger = React.useCallback(
    (node: BpNode) => {
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
      <div ref={canvasRef} className="relative min-h-0 flex-1" onContextMenu={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: e.clientX, y: e.clientY, left: e.clientX - r.left, top: e.clientY - r.top }) }} onClick={() => menu && setMenu(null)}>
        <ReactFlow<BpFlowNode>
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES as never}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={(_, n) => { const node = bp.nodes.find((x) => x.id === n.id); if (node) trigger(node) }}
          onNodeClick={(_, n) => {
            // Four quick clicks on the same node open its terminal (double-click still runs it). Own counter: the
            // native click `detail` resets per pointer sequence in WebKit/automation and never reaches 4 reliably.
            const now = Date.now()
            const q = quadClick.current
            if (q.id === n.id && now - q.at < 600) q.n += 1
            else {
              q.id = n.id
              q.n = 1
            }
            q.at = now
            if (q.n >= 4) {
              q.n = 0
              onNodeQuadClick(n.id)
            }
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
          <div className="absolute z-30 w-52 rounded-sm border border-line bg-ink-2 p-1 text-xs shadow-xl" style={{ left: menu.left, top: menu.top }}>
            {MENU.map((m) => (
              <button
                key={m.key}
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-text-1 hover:bg-ink-3"
                onClick={(e) => {
                  e.stopPropagation()
                  const pos = screenToFlowPosition({ x: menu.x, y: menu.y })
                  const node = addNode(bpId, m.type, pos.x, pos.y, m.key === "aiCustom" ? { ...m.data, title: t("bp.node.aiCustom") } : m.key === "bilinc" ? { ...m.data, title: t("bp.node.bilinc") } : m.key === "eylem" ? { ...m.data, title: t("bp.node.eylem") } : m.data)
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
      </div>
      <aside className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-ink-1 p-3">
        {selected ? <NodePanel bpId={bpId} node={selected} log={logs[selected.id] ?? []} onTrigger={() => trigger(selected)} onRemove={() => { removeNode(bpId, selected.id); setSelectedId(undefined) }} /> : <div className="text-xs text-text-3">{t("bp.panelHint")}</div>}
      </aside>
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
          {(node.type === "ai" || node.type === "prompt" || node.type === "button" || node.type === "wizard") && (running ? <NeonButton size="sm" variant="outline" onClick={() => void cancel(bpId, node.id)}>{t("common.cancel")}</NeonButton> : <NeonButton size="sm" onClick={onTrigger}>{node.type === "button" && d.type === "button" && d.kind === "send" ? <Send /> : <Play />}{t("bp.run")}</NeonButton>)}
          <button type="button" onClick={onRemove} className="rounded-sm border border-line px-2 text-text-3 hover:text-danger" aria-label={t("common.delete")}><Trash2 className="size-3.5" /></button>
        </div>
      </div>
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
                    const providers = Array.from(new Set([d.modelRef, ...(d.mode === "orchestration" ? d.pool ?? [] : [])].filter(Boolean).map((r) => parseModelRef(r).providerId as ProviderId)))
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
              {d.mode === "orchestration" && (
                <label className="col-span-2 flex flex-col gap-1 text-text-3">{t("bp.pool")}
                  <ModelSelectorGrid compact models={models} selected={d.pool ?? []} onToggle={(ref) => patch({ pool: (d.pool ?? []).includes(ref) ? (d.pool ?? []).filter((x) => x !== ref) : [...(d.pool ?? []), ref] })} />
                  <span className="text-[10px]">{t("bp.poolHint")}</span>
                </label>
              )}
            </div>
          )}
          <label className="flex flex-col gap-1 text-xs text-text-3">{t("bp.purpose")}
            <Textarea value={d.purpose ?? ""} onChange={(e) => patch({ purpose: e.target.value })} rows={4} placeholder={d.type === "wizard" ? t("bp.wizardPurposePlaceholder") : t("bp.aiPurposePlaceholder")} className="text-[12px]" />
          </label>
          {d.type === "ai" && d.role && (
            <div className="rounded-sm border border-line bg-ink-0 p-2 text-[11px] text-text-2">
              <div className="mb-1 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{d.role === "bilinc" ? t("bp.node.bilinc") : t("bp.node.eylem")}</div>
              {d.role === "bilinc" ? t("bp.roleHint.bilinc") : t("bp.roleHint.eylem")}
              {d.role === "bilinc" && (
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
  // Σ tokens: persisted per AI node + live subtask tokens of orchestration runs in flight (number selector).
  const liveTokens = useRunsStore((s) => (bp ? bp.nodes.reduce((acc, n) => acc + (n.status === "running" && n.executionId && !n.executionId.startsWith("session:") ? (s.byId(n.executionId)?.plan ?? []).reduce((a, st) => a + (st.tokens ?? 0), 0) : 0), 0) : 0))
  const totalTokens = (bp?.nodes.reduce((acc, n) => acc + (n.data.type === "ai" ? (n.data.tokens ?? 0) : 0), 0) ?? 0) + liveTokens
  const newBlueprint = async () => {
    const created = await create(t("bp.newName", { n: blueprints.length + 1 }))
    navigate(`/blueprint/${created.id}`)
  }
  return (
    <div className={cn("flex h-full min-h-0 flex-col", full && "fixed inset-0 z-50 bg-ink-0")}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <PageHeader eyebrow={t("bp.title")} title="" description="" className="mb-0" />
        <select value={id ?? ""} onChange={(e) => navigate(`/blueprint/${e.target.value}`)} className="rounded-sm border border-line bg-ink-2 px-2 py-1 text-xs text-text-1">
          {!id && <option value="">—</option>}
          {blueprints.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {bp && <Input value={bp.name} onChange={(e) => void rename(bp.id, e.target.value)} className="h-7 w-48 text-xs" />}
        <NeonButton size="sm" onClick={() => void newBlueprint()}><Plus />{t("bp.new")}</NeonButton>
        <NeonButton size="sm" variant="outline" onClick={() => setAutoOpen((v) => !v)} disabled={Boolean(autoStatus)}><Sparkles />{autoStatus ? t("bp.autoWorking") : t("bp.auto")}</NeonButton>
        {bp && <button type="button" onClick={() => { void remove(bp.id); navigate("/blueprint") }} className="ml-auto rounded-sm border border-line px-2 py-1 text-xs text-text-3 hover:text-danger">{t("common.delete")}</button>}
        {bp && <span className="mono shrink-0 rounded-sm border border-line px-2 py-0.5 text-[11px] whitespace-nowrap text-text-2" title={t("bp.tokensHint")}>{t("bp.totalTokens", { n: formatTokens(totalTokens) })}</span>}
        {bp && <button type="button" onClick={() => setFull((v) => !v)} title={full ? t("bp.exitFullscreen") : t("bp.fullscreen")} aria-label={full ? t("bp.exitFullscreen") : t("bp.fullscreen")} className="flex shrink-0 items-center gap-1 rounded-sm border border-line px-2 py-1 text-xs text-text-2 hover:text-text-1 [&_svg]:size-3.5">{full ? <Minimize2 /> : <Maximize2 />}{full ? t("bp.exitFullscreen") : t("bp.fullscreen")}</button>}
        <span className="text-[11px] text-text-3">{t("bp.hint", { mod: modKey() })}</span>
      </div>
      {autoOpen && (
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
      {autoSummary && bp && <div className="border-b border-line bg-ink-1 px-4 py-2 text-[11px] text-text-2">{autoSummary}</div>}
      {bp ? (
        <ReactFlowProvider>
          <Canvas key={bp.id} bpId={bp.id} onNodeQuadClick={(id) => setTerminalNode((cur) => (cur === id ? undefined : id))} />
          <NodeTerminal bpId={bp.id} nodeId={terminalNode} onClose={() => setTerminalNode(undefined)} />
        </ReactFlowProvider>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-text-3">{loaded ? t("bp.none") : t("common.loading")}</div>
      )}
    </div>
  )
}
