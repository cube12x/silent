import * as React from "react"
import "@xyflow/react/dist/style.css"
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Edge, type NodeChange } from "@xyflow/react"
import { useNavigate, useParams, useSearchParams } from "react-router"
import { cn } from "cn"
import { BrainCircuit, Play, Plus, RotateCcw, Trash2 } from "lucide-react"
import type { MindNodeType } from "@/domain"
import { useMindStore } from "@/stores/mind"
import { resolveMind } from "@/engine/mind/resolve"
import { composeMind } from "@/engine/mind/graph"
import { EmptyState, NeonButton, TacticalChip } from "@/design-system"
import { formatTokens } from "@/lib/format"
import { useT } from "@/i18n"
import { MIND_NODE_TYPES, type MindFlowNode } from "./mindNodes"
import { MindPanel } from "./MindPanel"
import { MindChat } from "./MindChat"
import { MindTerminal } from "./MindTerminal"

const MENU: MindNodeType[] = ["model", "gateway", "memory", "tools", "thinking"]

/** Two-click danger button (the webview has no confirm()): arms for 4 s. */
function ArmedButton({ label, armedLabel, onFire, icon, testId }: { label: string; armedLabel: string; onFire: () => void; icon: React.ReactNode; testId: string }) {
  const [armed, setArmed] = React.useState(false)
  React.useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <button type="button" data-testid={testId} title={armed ? armedLabel : label} onClick={() => { if (!armed) { setArmed(true); return } setArmed(false); onFire() }} className={cn("flex h-8 items-center gap-1.5 rounded-none border px-2.5 text-[12px]", armed ? "border-danger text-danger" : "border-line text-text-2 hover:border-text-2 hover:text-text-1")}>
      {icon}
      {armed ? armedLabel : label}
    </button>
  )
}

function Canvas({ modelId }: { modelId: string }) {
  const t = useT()
  const model = useMindStore((s) => s.byId(modelId))
  const updateNode = useMindStore((s) => s.updateNode)
  const removeNode = useMindStore((s) => s.removeNode)
  const addNode = useMindStore((s) => s.addNode)
  const addEdge = useMindStore((s) => s.addEdge)
  const removeEdge = useMindStore((s) => s.removeEdge)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [selectedId, setSelectedId] = React.useState<string | undefined>()
  const [menu, setMenu] = React.useState<{ x: number; y: number; left: number; top: number } | null>(null)
  const fittedRef = React.useRef(false)

  const composition = React.useMemo(() => (model ? composeMind(model) : undefined), [model])
  const stage = useMindStore((s) => s.activity[modelId]?.stage)
  const flowNodes = React.useMemo<MindFlowNode[]>(() => (model?.graph.nodes ?? []).map((n) => ({ id: n.id, type: n.type, position: { x: n.x, y: n.y }, selected: n.id === selectedId, data: { node: n, warnings: composition?.nodeWarnings[n.id] ?? [], modelId } })), [model, composition, selectedId, modelId])
  // Wires light up along the live path: Gateway → Bilinç while it thinks, Gateway/Araçlar → Eylem while it acts.
  const flowEdges = React.useMemo<Edge[]>(() => {
    const active = new Set<string>()
    for (const n of model?.graph.nodes ?? []) {
      if (n.data.type !== "model") continue
      const r = n.data.role
      if ((stage === "bilinc" && r === "bilinc") || ((stage === "eylem" || stage === "terminal") && r === "eylem") || (stage === "tek" && r === "tek")) active.add(n.id)
    }
    return (model?.graph.edges ?? []).map((e) => ({ id: e.id, source: e.from, target: e.to, animated: active.has(e.to), style: active.has(e.to) ? { stroke: "var(--mind)", strokeWidth: 2 } : undefined }))
  }, [model, stage])

  const onNodesChange = React.useCallback(
    (changes: NodeChange<MindFlowNode>[]) => {
      if (!fittedRef.current && changes.some((c) => c.type === "dimensions")) {
        fittedRef.current = true
        window.requestAnimationFrame(() => void fitView({ padding: 0.2, maxZoom: 1, duration: 0 }))
      }
      for (const c of changes) {
        if (c.type === "position" && c.position) updateNode(modelId, c.id, { x: c.position.x, y: c.position.y })
        else if (c.type === "select") setSelectedId((cur) => (c.selected ? c.id : cur === c.id ? undefined : cur))
      }
    },
    [modelId, updateNode, fitView],
  )
  const onConnect = React.useCallback((c: Connection) => { if (c.source && c.target) addEdge(modelId, c.source, c.target) }, [modelId, addEdge])
  const selected = model?.graph.nodes.find((n) => n.id === selectedId)
  if (!model) return null
  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="relative min-h-0 flex-1" onContextMenu={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: e.clientX, y: e.clientY, left: Math.min(e.clientX - r.left, Math.max(0, r.width - 216)), top: Math.min(e.clientY - r.top, Math.max(0, r.height - MENU.length * 34 - 8)) }) }} onClick={() => menu && setMenu(null)}>
        <ReactFlow<MindFlowNode>
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={MIND_NODE_TYPES as never}
          onNodesChange={onNodesChange}
          onEdgesChange={() => undefined}
          onNodesDelete={(deleted) => { for (const n of deleted) removeNode(modelId, n.id) }}
          onEdgesDelete={(deleted) => { for (const e of deleted) removeEdge(modelId, e.id) }}
          onConnect={onConnect}
          onPaneClick={() => { setMenu(null); setSelectedId(undefined) }}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.3}
          maxZoom={1.6}
          colorMode="dark"
          deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ style: { stroke: "var(--mind-soft)", strokeWidth: 1.5 } }}
          className="bg-ink-0"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(255,122,26,0.18)" />
        </ReactFlow>
        {model.graph.nodes.length > 0 && <button type="button" onClick={() => void fitView({ padding: 0.2, maxZoom: 1 })} className="absolute right-3 bottom-3 z-20 rounded-none border border-line bg-ink-2 px-2 py-1 text-[11px] text-text-2 hover:text-text-1">⤢ {t("bp.fit")}</button>}
        {model.graph.nodes.length === 0 && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-text-3">{t("mind.canvasEmpty")}</div>}
        {menu && (
          <div className="absolute z-30 w-52 rounded-none border border-line bg-ink-2 p-1 text-xs shadow-xl" style={{ left: menu.left, top: menu.top }} data-testid="mind-menu">
            {MENU.map((type) => (
              <button key={type} type="button" className="flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left text-text-1 hover:bg-ink-3" onClick={(e) => { e.stopPropagation(); const pos = screenToFlowPosition({ x: menu.x, y: menu.y }); const node = addNode(modelId, type, pos.x, pos.y); if (node) setSelectedId(node.id); setMenu(null) }}>
                <Plus className="size-3 text-text-3" />{t(`mind.menu.${type}` as never)}
              </button>
            ))}
          </div>
        )}
      </div>
      {selected && <MindPanel key={selected.id} model={model} node={selected} onClose={() => setSelectedId(undefined)} />}
    </div>
  )
}

export function MindScreen() {
  const t = useT()
  const navigate = useNavigate()
  const { mindId } = useParams()
  const [params] = useSearchParams()
  const models = useMindStore((s) => s.models)
  const model = useMindStore((s) => s.byId(mindId))
  const autorun = useMindStore((s) => s.autorun)
  const busy = useMindStore((s) => s.busy[mindId ?? ""])
  const create = useMindStore((s) => s.create)
  const update = useMindStore((s) => s.update)
  const start = useMindStore((s) => s.start)
  const reset = useMindStore((s) => s.reset)
  const remove = useMindStore((s) => s.remove)
  const setActive = useMindStore((s) => s.setActive)
  const [dock, setDock] = React.useState<"chat" | "terminal">("chat")

  React.useEffect(() => {
    if (!mindId && models.length) navigate(`/mind/${models[0]!.id}`, { replace: true })
  }, [mindId, models, navigate])
  React.useEffect(() => {
    setActive(mindId)
  }, [mindId, setActive])

  // `silent mind …` from the terminal (the shell sets the store first and navigates second: the URL param is a dependency).
  const autoParam = params.get("auto")
  React.useEffect(() => {
    if (!autorun || !autoParam) return
    const req = autorun
    useMindStore.setState({ autorun: undefined })
    queueMicrotask(() => {
      void (async () => {
        const s = useMindStore.getState()
        let target = resolveMind(s.models, req.ref)
        if (!target && req.new) target = await s.create(req.ref, { bilinc: req.new.bilinc, eylem: req.new.eylem, workspace: req.new.workspace ?? undefined })
        if (!target) return console.warn("[autostart] mind model not found", req.ref)
        navigate(`/mind/${target.id}`)
        if (req.reset) await s.reset(target.id)
        if (req.start || req.message || req.term) {
          if (useMindStore.getState().byId(target.id)?.status !== "started" && !(await s.start(target.id))) return
        }
        if (req.message) await s.send(target.id, req.message)
        if (req.term) {
          setDock("terminal")
          await s.terminalRun(target.id, req.term)
        }
      })()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorun, autoParam])

  const newModel = async () => {
    const m = await create()
    navigate(`/mind/${m.id}`)
  }

  if (!model) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={<BrainCircuit className="text-mind" />} title={t("mind.title")} description={t("mind.none")} action={<NeonButton onClick={() => void newModel()} data-testid="mind-new">{t("mind.newModel")}</NeonButton>} />
      </div>
    )
  }
  const started = model.status === "started"
  const composition = composeMind(model)
  const kindLabel = composition.kind === "pair" ? t("mind.pair") : composition.kind === "single" ? t("mind.single") : t("mind.warn.noModel")

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mind-screen">
      <div className="flex flex-wrap items-center gap-2 border-b border-mind/40 bg-ink-1/80 px-4 py-2">
        <BrainCircuit className="size-4 text-mind" />
        <input value={model.name} onChange={(e) => void update(model.id, { name: e.target.value })} aria-label={t("mind.name")} data-testid="mind-name" className="h-8 w-44 rounded-none border border-transparent bg-transparent px-1 font-heading text-[13px] font-semibold tracking-[0.12em] uppercase outline-none hover:border-line focus:border-mind" />
        <TacticalChip size="xs" tone={composition.kind === "none" ? "warn" : "neutral"} data-testid="mind-kind">{kindLabel}</TacticalChip>
        <span className="hidden text-[11px] text-text-3 lg:inline">{t("mind.canvasHint")}</span>
        <div className="ml-auto flex items-center gap-2">
          {(model.tokens ?? 0) > 0 && <TacticalChip size="xs" mono>Σ {formatTokens(model.tokens ?? 0)}</TacticalChip>}
          <span className="mono text-[10px] text-text-3">{model.mode === "plan" ? t("mind.planMode") : t("mind.actMode")}</span>
          {started ? (
            <span className="flex h-8 items-center gap-1.5 rounded-none border border-mind bg-mind/10 px-2.5 text-[12px] font-semibold text-mind" data-testid="mind-started"><span className={cn("size-1.5 rounded-full bg-success", busy && "animate-pulse")} />{t("mind.started")}</span>
          ) : (
            <button type="button" disabled={composition.kind === "none"} onClick={() => void start(model.id)} data-testid="mind-start" className="flex h-8 items-center gap-1.5 rounded-none bg-mind px-3 text-[12px] font-semibold text-black hover:bg-mind-soft disabled:cursor-not-allowed disabled:opacity-40"><Play className="size-3.5" />{t("mind.start")}</button>
          )}
          <ArmedButton label={t("mind.reset")} armedLabel={t("mind.resetArmed")} icon={<RotateCcw className="size-3.5" />} onFire={() => void reset(model.id)} testId="mind-reset" />
          <ArmedButton label="" armedLabel={t("mind.deleteArmed")} icon={<Trash2 className="size-3.5" />} onFire={() => void remove(model.id).then(() => navigate("/mind"))} testId="mind-delete" />
        </div>
      </div>

      <div className="flex min-h-0 flex-[3] flex-col">
        <ReactFlowProvider key={model.id}>
          <Canvas modelId={model.id} />
        </ReactFlowProvider>
      </div>

      <div className="flex min-h-0 flex-[2] flex-col border-t border-mind/40" data-testid="mind-dock">
        <div className="flex items-center gap-1 border-b border-line bg-ink-1 px-2">
          {(["chat", "terminal"] as const).map((k) => (
            <button key={k} type="button" data-testid={`mind-dock-${k}`} onClick={() => setDock(k)} className={cn("h-8 border-b-2 px-3 text-[11px] font-semibold tracking-[0.14em] uppercase", dock === k ? "border-mind text-mind" : "border-transparent text-text-3 hover:text-text-1")}>
              {t(`mind.${k}` as never)}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-text-3">{started ? t("mind.dockHint") : t("mind.notStarted")}</span>
        </div>
        <div className="min-h-0 flex-1">
          {dock === "chat" ? <MindChat model={model} /> : <div className="h-full p-2"><MindTerminal model={model} /></div>}
        </div>
      </div>
    </div>
  )
}
