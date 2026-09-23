import * as React from "react"
import { useNavigate } from "react-router"
import { cn } from "cn"
import { Bot, FolderGit2, MessageSquare, Sparkles, ChevronRight, ChevronLeft, Check } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useUiStore, type NewSessionPreset } from "@/stores/ui"
import { MODELS } from "@/engine/capabilities"
import { useProvidersStore } from "@/stores/providers"
import { useAgentsStore } from "@/stores/agents"
import { useChatsStore } from "@/stores/chats"
import { useSettingsStore } from "@/stores/settings"
import { useActivityStore } from "@/stores/activity"
import { getBackend } from "@/services"
import { interpretGateway, humanTrait } from "@/engine/gateway"
import { ModelSelectorGrid, NeonButton, TacticalChip, KeyValueList, ModelTag } from "@/design-system"
import { PERMISSION_LABELS, type RepoInfo } from "@/domain"

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
      <DialogContent className="max-w-3xl gap-0 overflow-hidden border-line bg-ink-1 p-0 sm:max-w-3xl">
        {preset && <NewSessionForm key={preset.nonce} preset={preset} close={close} />}
      </DialogContent>
    </Dialog>
  )
}

function NewSessionForm({ preset, close }: { preset: NonNullable<NewSessionPreset>; close: () => void }) {
  const providers = useProvidersStore((s) => s.providers)
  const enabledModels = React.useMemo(() => {
    const on = new Set(providers.filter((p) => p.enabled).map((p) => p.id))
    return MODELS.filter((m) => on.has(m.providerId))
  }, [providers])
  const settings = useSettingsStore((s) => s.settings)
  const agents = useAgentsStore((s) => s.agents)
  const createAgent = useAgentsStore((s) => s.create)
  const createChat = useChatsStore((s) => s.create)
  const pushActivity = useActivityStore((s) => s.push)
  const navigate = useNavigate()

  const [kind, setKind] = React.useState<"standard" | "repo-agent">(preset.kind)
  const [step, setStep] = React.useState<Step>("type")
  const [modelId, setModelId] = React.useState(settings.defaultPrimaryModelId)
  const [fallbacks, setFallbacks] = React.useState<string[]>([settings.defaultFallbackModelId])
  const [repoPath, setRepoPath] = React.useState("")
  const [repoInfo, setRepoInfo] = React.useState<RepoInfo | null>(null)
  const [existingAgentId, setExistingAgentId] = React.useState<string | undefined>(preset.repoAgentId)
  const [name, setName] = React.useState("")
  const [gateway, setGateway] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const profile = React.useMemo(() => interpretGateway(gateway), [gateway])
  const steps: Step[] = kind === "repo-agent" ? ["type", "model", "repo", "gateway"] : ["type", "model", "gateway"]
  const idx = steps.indexOf(step)

  const pick = async () => {
    const backend = await getBackend()
    const p = await backend.pickDirectory()
    if (p) {
      setRepoPath(p)
      setRepoInfo(await backend.repoInspect(p))
    }
  }
  const inspect = async (p: string) => {
    setRepoPath(p)
    if (!p) return setRepoInfo(null)
    const backend = await getBackend()
    setRepoInfo(await backend.repoInspect(p))
  }

  const finish = async () => {
    setBusy(true)
    try {
      if (kind === "repo-agent") {
        const agent = await createAgent({ name, repoPath, primaryModelId: modelId, fallbackModelIds: fallbacks.filter((f) => f !== modelId), gatewayPrompt: gateway })
        void pushActivity({ kind: "agent", title: `Repo agent created · ${agent.name}`, detail: agent.gatewayProfile.summary, refRoute: `/agents/${agent.id}`, ok: true })
        close()
        navigate(`/agents/${agent.id}`)
      } else {
        const agent = agents.find((a) => a.id === existingAgentId)
        const chat = await createChat({ kind: agent ? "repo-agent" : "standard", modelId, repoAgentId: agent?.id, repoPath: agent?.repoPath ?? (repoPath || undefined), gatewayPrompt: gateway || agent?.gatewayPrompt })
        close()
        navigate(`/chat/${chat.id}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const canNext = step === "type" || (step === "model" && !!modelId) || (step === "repo" && !!repoPath && !!name) || step === "gateway"

  return (
    <>
        <DialogHeader className="border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-lg border border-cyan/40 bg-cyan/10 text-cyan"><Sparkles className="size-4" /></span>
            <div>
              <DialogTitle className="font-heading text-base">{kind === "repo-agent" ? "Create Repo Agent" : "New Chat"}</DialogTitle>
              <DialogDescription className="text-xs text-text-3">{kind === "repo-agent" ? "Bind a repository, pick a model, and let Silent interpret your Gateway prompt." : "Pick a model, optionally attach a repo agent and a Gateway prompt."}</DialogDescription>
            </div>
            <ol className="ml-auto flex items-center gap-1">
              {steps.map((s, i) => (
                <li key={s} className={cn("mono flex h-6 items-center gap-1 rounded-md border px-2 text-[10px] uppercase", i === idx ? "border-cyan/50 text-cyan" : i < idx ? "border-success/40 text-success" : "border-line text-text-3")}>
                  {i < idx ? <Check className="size-3" /> : <span>{i + 1}</span>}
                  {s}
                </li>
              ))}
            </ol>
          </div>
        </DialogHeader>

        <div className="min-h-[360px] px-6 py-5">
          {step === "type" && (
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { k: "standard", icon: <MessageSquare />, title: "Standard chat", desc: "Direct conversation with one model. Attach a repo agent to make it repo-aware." },
                  { k: "repo-agent", icon: <Bot />, title: "Repo agent", desc: "A persistent, specialised agent bound to a local repository with its own Gateway, permissions and memory." },
                ] as const
              ).map((o) => (
                <button key={o.k} type="button" onClick={() => setKind(o.k)} className={cn("flex flex-col gap-3 rounded-xl border p-4 text-left transition-all", kind === o.k ? "border-cyan/50 bg-cyan/[0.06] shadow-glow" : "border-line bg-ink-2/60 hover:border-line-strong")}>
                  <span className={cn("flex size-9 items-center justify-center rounded-lg border [&_svg]:size-4", kind === o.k ? "border-cyan/50 text-cyan" : "border-line text-text-2")}>{o.icon}</span>
                  <span className="font-heading text-sm font-semibold text-text-1">{o.title}</span>
                  <span className="text-xs text-text-2">{o.desc}</span>
                </button>
              ))}
              {kind === "standard" && agents.length > 0 && (
                <div className="col-span-2 mt-2">
                  <div className="mb-1.5 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">Attach repo agent (optional)</div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setExistingAgentId(undefined)} className={cn("rounded-md border px-2 py-1 text-xs", !existingAgentId ? "border-cyan/50 text-cyan" : "border-line text-text-2")}>None</button>
                    {agents.map((a) => (
                      <button key={a.id} type="button" onClick={() => { setExistingAgentId(a.id); setModelId(a.primaryModelId) }} className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs", existingAgentId === a.id ? "border-cyan/50 text-cyan" : "border-line text-text-2")}>
                        <FolderGit2 className="size-3" />{a.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "model" && (
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">Primary model</div>
                <ModelSelectorGrid models={enabledModels} providers={providers} selected={[modelId]} onToggle={(id) => setModelId(id)} />
              </div>
              {kind === "repo-agent" && (
                <div>
                  <div className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">Fallback models (in order)</div>
                  <ModelSelectorGrid compact models={enabledModels.filter((m) => m.id !== modelId)} providers={providers} selected={fallbacks} onToggle={(id) => setFallbacks((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))} />
                </div>
              )}
            </div>
          )}

          {step === "repo" && (
            <div className="grid grid-cols-[1fr_280px] gap-5">
              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">Agent name</span>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Reach Backend" className="border-line bg-ink-2" />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">Local repository path</span>
                  <div className="flex gap-2">
                    <Input value={repoPath} onChange={(e) => void inspect(e.target.value)} placeholder="/Users/you/code/project" className="mono border-line bg-ink-2 text-xs" />
                    <NeonButton variant="outline" type="button" onClick={pick}><FolderGit2 />Browse</NeonButton>
                  </div>
                </label>
                <p className="text-xs text-text-3">Silent binds the agent to this path. Codex runs with <span className="mono text-text-2">-C &lt;path&gt;</span> and a sandbox derived from the agent's permissions.</p>
              </div>
              <div className="rounded-xl border border-line bg-ink-2/60 p-3">
                <div className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">Repository</div>
                {repoInfo ? (
                  <KeyValueList items={[{ label: "Name", value: repoInfo.name }, { label: "Git", value: repoInfo.isGitRepo ? repoInfo.branch ?? "yes" : "no", mono: true }, { label: "Files", value: repoInfo.fileCount ?? "—" }, { label: "Languages", value: repoInfo.languages.join(", ") || "—" }]} />
                ) : (
                  <div className="text-xs text-text-3">Pick a folder to inspect it.</div>
                )}
              </div>
            </div>
          )}

          {step === "gateway" && (
            <div className="grid grid-cols-[1fr_300px] gap-5">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">Gateway prompt {kind === "standard" && "(optional)"}</span>
                  <span className="text-[10px] text-text-3">natural language → behaviour profile</span>
                </div>
                <Textarea value={gateway} onChange={(e) => setGateway(e.target.value)} rows={7} placeholder={GATEWAY_EXAMPLES[0]} className="border-line bg-ink-2 text-sm" />
                <div className="flex flex-wrap gap-1.5">
                  {GATEWAY_EXAMPLES.map((ex, i) => (
                    <button key={i} type="button" onClick={() => setGateway(ex)} className="rounded-md border border-line px-2 py-1 text-[11px] text-text-2 hover:border-cyan/50 hover:text-cyan">example {i + 1}</button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-ink-2/60 p-3">
                <div className="text-[10px] font-semibold tracking-[0.18em] text-cyan/80 uppercase">Interpreted profile</div>
                <KeyValueList items={[{ label: "Role", value: profile.role }, { label: "Style", value: profile.taskStyle }, { label: "Model", value: <ModelTag modelId={modelId} size="xs" /> }]} />
                <div>
                  <div className="mb-1 text-[10px] tracking-wider text-text-3 uppercase">Behaviour</div>
                  <div className="flex flex-wrap gap-1">{profile.behaviorProfile.length ? profile.behaviorProfile.map((t) => <TacticalChip key={t} size="xs" tone="cyan">{humanTrait(t)}</TacticalChip>) : <span className="text-[11px] text-text-3">defaults</span>}</div>
                </div>
                <div>
                  <div className="mb-1 text-[10px] tracking-wider text-text-3 uppercase">Guardrails</div>
                  <ul className="flex flex-col gap-1 text-[11px] text-text-2">{profile.guardrails.length ? profile.guardrails.map((g) => <li key={g} className="flex gap-1.5"><span className="text-cyan">›</span>{g}</li>) : <li className="text-text-3">none derived</li>}</ul>
                </div>
                <div>
                  <div className="mb-1 text-[10px] tracking-wider text-text-3 uppercase">Permissions derived</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(profile.permissions).map(([k, v]) => (
                      <TacticalChip key={k} size="xs" tone={v ? "success" : "danger"}>{PERMISSION_LABELS[k as keyof typeof PERMISSION_LABELS]}: {v ? "on" : "off"}</TacticalChip>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-6 py-3">
          <button type="button" onClick={() => setStep(steps[Math.max(0, idx - 1)])} disabled={idx === 0} className="flex items-center gap-1 text-xs text-text-2 hover:text-text-1 disabled:opacity-40"><ChevronLeft className="size-3.5" />Back</button>
          <div className="flex items-center gap-2">
            <NeonButton variant="ghost" type="button" onClick={close}>Cancel</NeonButton>
            {idx < steps.length - 1 ? (
              <NeonButton type="button" disabled={!canNext} onClick={() => setStep(steps[idx + 1])}>Continue<ChevronRight /></NeonButton>
            ) : (
              <NeonButton type="button" disabled={busy || (kind === "repo-agent" && (!repoPath || !name))} onClick={finish}>{kind === "repo-agent" ? "Create agent" : "Start chat"}<ChevronRight /></NeonButton>
            )}
          </div>
        </div>
    </>
  )
}
