import * as React from "react"
import { useNavigate } from "react-router"
import { cn } from "cn"
import { Bot, FolderGit2, MessageSquare, Sparkles, ChevronRight, ChevronLeft, Check } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useUiStore, type NewSessionPreset } from "@/stores/ui"
import { useProvidersStore, selectAvailableModels } from "@/stores/providers"
import { useAgentsStore } from "@/stores/agents"
import { useChatsStore } from "@/stores/chats"
import { useSettingsStore } from "@/stores/settings"
import { getBackend } from "@/services"
import { interpretGateway, humanTrait } from "@/engine/gateway"
import { ModelSelectorGrid, NeonButton, TacticalChip, KeyValueList, ModelTag } from "@/design-system"
import { modelRef, parseModelRef, type ProviderId, type RepoInfo, type PermissionKey } from "@/domain"
import { useT } from "@/i18n"

const GATEWAY_EXAMPLES = [
  "Act like a senior backend engineer for this repo. Respect current architecture. Check tests before claiming completion. Avoid unnecessary dependencies. Focus on stability and clean code.",
  "Senior frontend engineer. Strict TypeScript, no any. Do not refactor unrelated code. Explain your decisions.",
  "Security-focused reviewer. Read-only. Never commit. Flag any unvalidated input.",
]
type Step = "type" | "model" | "repo" | "gateway"

export function NewSessionModal() {
  const preset = useUiStore((s) => s.newSession)
  const close = useUiStore((s) => s.closeNewSession)
  return (
    <Dialog open={!!preset} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden border-line bg-ink-1 p-0 sm:max-w-3xl">{preset && <NewSessionForm key={preset.nonce} preset={preset} close={close} />}</DialogContent>
    </Dialog>
  )
}

function NewSessionForm({ preset, close }: { preset: NonNullable<NewSessionPreset>; close: () => void }) {
  const t = useT()
  const providers = useProvidersStore((s) => s.providers)
  const models = React.useMemo(() => selectAvailableModels(providers), [providers])
  const settings = useSettingsStore((s) => s.settings)
  const agents = useAgentsStore((s) => s.agents)
  const createAgent = useAgentsStore((s) => s.create)
  const createChat = useChatsStore((s) => s.create)
  const navigate = useNavigate()
  const [kind, setKind] = React.useState<"standard" | "repo-agent">(preset.kind)
  const [step, setStep] = React.useState<Step>("type")
  const [ref, setRef] = React.useState(settings.defaultModelRef || (models[0] ? modelRef(models[0].providerId, models[0].id) : ""))
  const [fallbacks, setFallbacks] = React.useState<string[]>(settings.fallbackModelRef ? [settings.fallbackModelRef] : [])
  const [repoPath, setRepoPath] = React.useState("")
  const [repoInfo, setRepoInfo] = React.useState<RepoInfo | null>(null)
  const [existingAgentId, setExistingAgentId] = React.useState<string | undefined>(preset.repoAgentId)
  const [name, setName] = React.useState("")
  const [gateway, setGateway] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const profile = React.useMemo(() => interpretGateway(gateway), [gateway])
  const steps: Step[] = kind === "repo-agent" ? ["type", "model", "repo", "gateway"] : ["type", "model", "gateway"]
  const idx = steps.indexOf(step)

  const inspect = async (p: string) => {
    setRepoPath(p)
    if (!p) return setRepoInfo(null)
    const backend = await getBackend()
    setRepoInfo(await backend.repoInspect(p))
  }
  const pick = async () => {
    const backend = await getBackend()
    const p = await backend.pickDirectory()
    if (p) await inspect(p)
  }
  const finish = async () => {
    setBusy(true)
    try {
      const { providerId, modelId } = parseModelRef(ref)
      if (kind === "repo-agent") {
        const agent = await createAgent({ name, repoPath, providerId: providerId as ProviderId, modelId, fallbackModelRefs: fallbacks.filter((f) => f !== ref), gatewayPrompt: gateway })
        close()
        navigate(`/agents/${agent.id}`)
      } else {
        const agent = agents.find((a) => a.id === existingAgentId)
        const chat = await createChat({ kind: agent ? "repo-agent" : "standard", providerId: providerId as ProviderId, modelId, repoAgentId: agent?.id, repoPath: agent?.repoPath, gatewayPrompt: gateway || agent?.gatewayPrompt })
        close()
        navigate(`/chat/${chat.id}`)
      }
    } finally {
      setBusy(false)
    }
  }
  const canNext = step === "type" || (step === "model" && !!ref) || (step === "repo" && !!repoPath && !!name) || step === "gateway"

  return (
    <>
      <DialogHeader className="border-b border-line px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg border border-cyan/40 bg-cyan/10 text-cyan"><Sparkles className="size-4" /></span>
          <div>
            <DialogTitle className="font-heading text-base">{kind === "repo-agent" ? t("modal.newAgent") : t("modal.newChat")}</DialogTitle>
            <DialogDescription className="text-xs text-text-3">{kind === "repo-agent" ? t("modal.agentDesc") : t("modal.chatDesc")}</DialogDescription>
          </div>
          <ol className="ml-auto flex items-center gap-1">
            {steps.map((s, i) => <li key={s} className={cn("mono flex h-6 items-center gap-1 rounded-md border px-2 text-[10px] uppercase", i === idx ? "border-cyan/50 text-cyan" : i < idx ? "border-success/40 text-success" : "border-line text-text-3")}>{i < idx ? <Check className="size-3" /> : <span>{i + 1}</span>}{t(`modal.steps.${s}` as const)}</li>)}
          </ol>
        </div>
      </DialogHeader>
      <div className="min-h-[340px] px-6 py-5">
        {step === "type" && (
          <div className="grid grid-cols-2 gap-3">
            {([{ k: "standard", icon: <MessageSquare />, title: t("modal.standard"), desc: t("modal.standardDesc") }, { k: "repo-agent", icon: <Bot />, title: t("modal.agent"), desc: t("modal.agentDesc2") }] as const).map((o) => (
              <button key={o.k} type="button" onClick={() => setKind(o.k)} className={cn("flex flex-col gap-3 rounded-xl border p-4 text-left transition-all", kind === o.k ? "border-cyan/50 bg-cyan/[0.06] " : "border-line bg-ink-2/60 hover:border-line-strong")}>
                <span className={cn("flex size-9 items-center justify-center rounded-lg border [&_svg]:size-4", kind === o.k ? "border-cyan/50 text-cyan" : "border-line text-text-2")}>{o.icon}</span>
                <span className="font-heading text-sm font-semibold text-text-1">{o.title}</span>
                <span className="text-xs text-text-2">{o.desc}</span>
              </button>
            ))}
            {kind === "standard" && agents.length > 0 && (
              <div className="col-span-2 mt-2">
                <div className="mb-1.5 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">{t("modal.attachAgent")}</div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setExistingAgentId(undefined)} className={cn("rounded-md border px-2 py-1 text-xs", !existingAgentId ? "border-cyan/50 text-cyan" : "border-line text-text-2")}>{t("common.none")}</button>
                  {agents.map((a) => <button key={a.id} type="button" onClick={() => { setExistingAgentId(a.id); setRef(modelRef(a.providerId, a.modelId)) }} className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs", existingAgentId === a.id ? "border-cyan/50 text-cyan" : "border-line text-text-2")}><FolderGit2 className="size-3" />{a.name}</button>)}
                </div>
              </div>
            )}
          </div>
        )}
        {step === "model" && (
          <div className="flex flex-col gap-4">
            {models.length === 0 && <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs text-warn">{t("modal.noModels")}</div>}
            <div><div className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">{t("modal.primaryModel")}</div><ModelSelectorGrid single models={models} selected={[ref]} onToggle={(r) => setRef(r)} /></div>
            {kind === "repo-agent" && <div><div className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">{t("modal.fallbackModels")}</div><ModelSelectorGrid compact models={models.filter((m) => modelRef(m.providerId, m.id) !== ref)} selected={fallbacks} onToggle={(r) => setFallbacks((f) => (f.includes(r) ? f.filter((x) => x !== r) : [...f, r]))} /></div>}
          </div>
        )}
        {step === "repo" && (
          <div className="grid grid-cols-[1fr_280px] gap-5">
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5"><span className="text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">{t("modal.agentName")}</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("modal.agentNamePh")} className="border-line bg-ink-2" /></label>
              <label className="flex flex-col gap-1.5"><span className="text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">{t("modal.repoPath")}</span><div className="flex gap-2"><Input value={repoPath} onChange={(e) => void inspect(e.target.value)} placeholder="/Users/you/code/project" className="mono border-line bg-ink-2 text-xs" /><NeonButton variant="outline" type="button" onClick={pick}><FolderGit2 />{t("common.browse")}</NeonButton></div></label>
              <p className="text-xs text-text-3">{t("modal.repoHint")}</p>
            </div>
            <div className="rounded-xl border border-line bg-ink-2/60 p-3">
              <div className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">{t("modal.repoInfo")}</div>
              {repoInfo ? <KeyValueList items={[{ label: "name", value: repoInfo.name }, { label: "git", value: repoInfo.isGitRepo ? repoInfo.branch ?? "yes" : "no", mono: true }, { label: "files", value: repoInfo.fileCount ?? "—" }, { label: "lang", value: repoInfo.languages.join(", ") || "—" }]} /> : <div className="text-xs text-text-3">{t("modal.pickFolder")}</div>}
            </div>
          </div>
        )}
        {step === "gateway" && (
          <div className="grid grid-cols-[1fr_300px] gap-5">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between"><span className="text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">{t("modal.gatewayPrompt")} {kind === "standard" && t("modal.optional")}</span><span className="text-[10px] text-text-3">{t("modal.gatewayHint")}</span></div>
              <Textarea value={gateway} onChange={(e) => setGateway(e.target.value)} rows={7} placeholder={GATEWAY_EXAMPLES[0]} className="border-line bg-ink-2 text-sm" />
              <div className="flex flex-wrap gap-1.5">{GATEWAY_EXAMPLES.map((ex, i) => <button key={i} type="button" onClick={() => setGateway(ex)} className="rounded-md border border-line px-2 py-1 text-[11px] text-text-2 hover:border-cyan/50 hover:text-cyan">{t("modal.example", { n: i + 1 })}</button>)}</div>
            </div>
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-ink-2/60 p-3">
              <div className="text-[10px] font-semibold tracking-[0.18em] text-cyan/80 uppercase">{t("modal.interpreted")}</div>
              <KeyValueList items={[{ label: t("modal.role"), value: profile.role }, { label: t("agents.style"), value: profile.taskStyle }, { label: t("common.model"), value: ref ? <ModelTag modelRef={ref} size="xs" /> : "—" }]} />
              <div><div className="mb-1 text-[10px] tracking-wider text-text-3 uppercase">{t("agents.behavior")}</div><div className="flex flex-wrap gap-1">{profile.behaviorProfile.length ? profile.behaviorProfile.map((x) => <TacticalChip key={x} size="xs" tone="cyan">{humanTrait(x)}</TacticalChip>) : <span className="text-[11px] text-text-3">{t("agents.defaults")}</span>}</div></div>
              <div><div className="mb-1 text-[10px] tracking-wider text-text-3 uppercase">{t("agents.guardrails")}</div><ul className="flex flex-col gap-1 text-[11px] text-text-2">{profile.guardrails.length ? profile.guardrails.map((g) => <li key={g} className="flex gap-1.5"><span className="text-cyan">›</span>{g}</li>) : <li className="text-text-3">{t("agents.noneDerived")}</li>}</ul></div>
              <div><div className="mb-1 text-[10px] tracking-wider text-text-3 uppercase">{t("modal.permsDerived")}</div><div className="flex flex-wrap gap-1">{Object.entries(profile.permissions).map(([k, v]) => <TacticalChip key={k} size="xs" tone={v ? "success" : "danger"}>{t(`agents.permLabels.${k as PermissionKey}` as const)}: {v ? "on" : "off"}</TacticalChip>)}</div></div>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line px-6 py-3">
        <button type="button" onClick={() => setStep(steps[Math.max(0, idx - 1)])} disabled={idx === 0} className="flex items-center gap-1 text-xs text-text-2 hover:text-text-1 disabled:opacity-40"><ChevronLeft className="size-3.5" />{t("common.back")}</button>
        <div className="flex items-center gap-2">
          <NeonButton variant="ghost" type="button" onClick={close}>{t("common.cancel")}</NeonButton>
          {idx < steps.length - 1 ? <NeonButton type="button" disabled={!canNext} onClick={() => setStep(steps[idx + 1])}>{t("common.continue")}<ChevronRight /></NeonButton> : <NeonButton type="button" disabled={busy || !ref || (kind === "repo-agent" && (!repoPath || !name))} onClick={finish}>{kind === "repo-agent" ? t("modal.createAgent") : t("modal.startChat")}<ChevronRight /></NeonButton>}
        </div>
      </div>
    </>
  )
}
