import * as React from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"
import { cn } from "cn"
import { BrainCircuit, Database, Play, RotateCcw, Trash2, Wrench, Settings2, Cpu } from "lucide-react"
import { useMindStore } from "@/stores/mind"
import { resolveMind } from "@/engine/mind/resolve"
import { EmptyState, NeonButton, TacticalChip } from "@/design-system"
import { formatTokens } from "@/lib/format"
import { useT } from "@/i18n"
import { ActorChip } from "./ActorChip"
import { MindChat } from "./MindChat"
import { MindTerminal } from "./MindTerminal"
import { DepotDialog, GatewayDialog, LiveMemory, ModelDialog, ToolsDialog } from "./MindDialogs"

type DialogKind = "model" | "gateway" | "depot" | "tools" | null

/** Two-click danger button (the webview has no confirm()): arms for 4 s. */
function ArmedButton({ label, armedLabel, onFire, icon, testId }: { label: string; armedLabel: string; onFire: () => void; icon: React.ReactNode; testId: string }) {
  const [armed, setArmed] = React.useState(false)
  React.useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <button
      type="button"
      data-testid={testId}
      title={armed ? armedLabel : label}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }
        setArmed(false)
        onFire()
      }}
      className={cn("flex h-8 items-center gap-1.5 rounded-none border px-2.5 text-[12px]", armed ? "border-danger text-danger" : "border-line text-text-2 hover:border-text-2 hover:text-text-1")}
    >
      {icon}
      {armed ? armedLabel : label}
    </button>
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
  const [dialog, setDialog] = React.useState<DialogKind>(null)

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
        if (!target && req.new) {
          // `silent mind new <name> <bilinç> <eylem>`: create it here, in the terminal's folder.
          const created = await s.create(req.ref)
          await s.update(created.id, { bilinc: { modelRef: req.new.bilinc }, eylem: { modelRef: req.new.eylem }, workspace: req.new.workspace ?? undefined })
          target = useMindStore.getState().byId(created.id)
        }
        if (!target) return console.warn("[autostart] mind model not found", req.ref)
        navigate(`/mind/${target.id}`)
        if (req.reset) await s.reset(target.id)
        if (req.start || req.message || req.term) {
          if (useMindStore.getState().byId(target.id)?.status !== "started" && !(await s.start(target.id))) return
        }
        if (req.message) await s.send(target.id, req.message)
        if (req.term) await s.terminalRun(target.id, req.term)
      })()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorun, autoParam])

  const newModel = async () => {
    const m = await create()
    navigate(`/mind/${m.id}`)
    setDialog("model")
  }

  if (!model) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={<BrainCircuit className="text-mind" />} title={t("mind.title")} description={t("mind.none")} action={<NeonButton onClick={() => void newModel()} data-testid="mind-new">{t("mind.newModel")}</NeonButton>} />
      </div>
    )
  }
  const started = model.status === "started"
  const ready = Boolean(model.bilinc.modelRef && model.eylem.modelRef)
  const headerButton = (kind: Exclude<DialogKind, null>, icon: React.ReactNode, label: string) => (
    <button type="button" data-testid={`mind-btn-${kind}`} onClick={() => setDialog(kind)} className={cn("flex h-8 items-center gap-1.5 rounded-none border px-2.5 text-[12px] transition-colors", dialog === kind ? "border-mind text-mind" : "border-line text-text-2 hover:border-mind/60 hover:text-text-1")}>
      {icon}{label}
    </button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mind-screen">
      <div className="flex flex-wrap items-center gap-2 border-b border-mind/40 bg-ink-1/80 px-4 py-2">
        <BrainCircuit className="size-4 text-mind" />
        <input value={model.name} onChange={(e) => void update(model.id, { name: e.target.value })} aria-label={t("mind.name")} data-testid="mind-name" className="h-8 w-44 rounded-none border border-transparent bg-transparent px-1 font-heading text-[13px] font-semibold tracking-[0.12em] uppercase outline-none hover:border-line focus:border-mind" />
        <span className="mx-1 h-5 w-px bg-line" />
        {headerButton("model", <Cpu className="size-3.5" />, t("mind.modelBtn"))}
        {headerButton("gateway", <Settings2 className="size-3.5" />, t("mind.gatewayBtn"))}
        {headerButton("depot", <Database className="size-3.5" />, t("mind.memoryBtn"))}
        {headerButton("tools", <Wrench className="size-3.5" />, t("mind.toolsBtn"))}
        <span className="ml-2 hidden items-center gap-1.5 lg:flex">
          <ActorChip actor="bilinc" modelRef={model.bilinc.modelRef || undefined} size="xs" />
          <ActorChip actor="eylem" modelRef={model.eylem.modelRef || undefined} size="xs" />
        </span>
        <div className="ml-auto flex items-center gap-2">
          {(model.tokens ?? 0) > 0 && <TacticalChip size="xs" mono>Σ {formatTokens(model.tokens ?? 0)}</TacticalChip>}
          {started ? (
            <span className="flex h-8 items-center gap-1.5 rounded-none border border-mind bg-mind/10 px-2.5 text-[12px] font-semibold text-mind" data-testid="mind-started"><span className={cn("size-1.5 rounded-full bg-success", busy && "animate-pulse")} />{t("mind.started")}</span>
          ) : (
            <button type="button" disabled={!ready} onClick={() => void start(model.id)} data-testid="mind-start" className="flex h-8 items-center gap-1.5 rounded-none bg-mind px-3 text-[12px] font-semibold text-black hover:bg-mind-soft disabled:cursor-not-allowed disabled:opacity-40"><Play className="size-3.5" />{t("mind.start")}</button>
          )}
          <ArmedButton label={t("mind.reset")} armedLabel={t("mind.resetArmed")} icon={<RotateCcw className="size-3.5" />} onFire={() => void reset(model.id)} testId="mind-reset" />
          <ArmedButton label="" armedLabel={t("mind.deleteArmed")} icon={<Trash2 className="size-3.5" />} onFire={() => void remove(model.id).then(() => navigate("/mind"))} testId="mind-delete" />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        <div className="min-h-0 border-r border-line"><MindChat model={model} /></div>
        <div className="flex min-h-0 flex-col gap-2 p-2">
          <div className="text-[10px] tracking-[0.16em] text-text-3 uppercase">{t("mind.terminal")}</div>
          <div className={cn("min-h-0", started ? "flex-[3]" : "flex-1")}><MindTerminal model={model} /></div>
          {started && <div className="min-h-0 flex-[2]"><LiveMemory model={model} /></div>}
        </div>
      </div>

      <ModelDialog model={model} open={dialog === "model"} onClose={() => setDialog(null)} />
      {dialog === "gateway" && <GatewayDialog model={model} open onClose={() => setDialog(null)} />}
      <DepotDialog model={model} open={dialog === "depot"} onClose={() => setDialog(null)} />
      <ToolsDialog model={model} open={dialog === "tools"} onClose={() => setDialog(null)} />
    </div>
  )
}
