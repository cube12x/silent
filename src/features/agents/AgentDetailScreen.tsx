import { getBackend } from "@/services"
import * as React from "react"
import { useNavigate, useParams } from "react-router"
import { cn } from "cn"
import { Brain, FolderGit2, GitBranch, MessageSquare, Shield, Trash2, Wrench, Zap, CheckCircle2, XCircle, Save, Plus, X } from "lucide-react"
import { useAgentsStore } from "@/stores/agents"
import { useMemoryStore } from "@/stores/memory"
import { useUiStore } from "@/stores/ui"
import { useChatsStore } from "@/stores/chats"
import { useRunsStore } from "@/stores/runs"
import { EmptyState, GlowCard, KeyValueList, ModelLogo, ModelTag, NeonButton, PageHeader, PermissionToggle, SectionHeader, TacticalChip, RunStatusBadge } from "@/design-system"
import { modelRef, type PermissionKey, type RunStatus } from "@/domain"
import { humanTrait } from "@/engine/gateway"
import { formatRelative } from "@/lib/format"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { useT } from "@/i18n"
import { ModelPicker } from "@/features/chat/ModelPicker"

const PERMS: PermissionKey[] = ["read", "write", "runTests", "terminal", "gitCommit", "gitPush", "network", "fileCreateDelete"]
const DANGER: PermissionKey[] = ["gitPush", "network", "fileCreateDelete"]

function GatewayEditor({ initial, role, summary, onSave }: { initial: string; role: string; summary: string; onSave: (g: string) => void }) {
  const t = useT()
  const [gateway, setGateway] = React.useState(initial)
  const dirty = gateway !== initial
  return (
    <>
      <SectionHeader eyebrow={t("agents.gateway")} title={role} description={summary} actions={dirty ? <NeonButton size="sm" onClick={() => onSave(gateway)}><Save />{t("agents.reinterpret")}</NeonButton> : undefined} />
      <Textarea value={gateway} onChange={(e) => setGateway(e.target.value)} rows={3} className="border-line bg-ink-0/60 text-sm" />
    </>
  )
}

export function AgentDetailScreen() {
  const t = useT()
  const { agentId } = useParams()
  const navigate = useNavigate()
  const agent = useAgentsStore((s) => s.byId(agentId))
  const setPermission = useAgentsStore((s) => s.setPermission)
  const update = useAgentsStore((s) => s.update)
  const remove = useAgentsStore((s) => s.remove)
  const allMemory = useMemoryStore((s) => s.entries)
  const addMemory = useMemoryStore((s) => s.add)
  const removeMemory = useMemoryStore((s) => s.remove)
  const allRuns = useRunsStore((s) => s.runs)
  const memory = React.useMemo(() => allMemory.filter((m) => m.scopeId === agentId), [allMemory, agentId])
  const runs = React.useMemo(() => allRuns.filter((r) => r.repoAgentId === agentId), [allRuns, agentId])
  const openNewSession = useUiStore((s) => s.openNewSession)
  const createChat = useChatsStore((s) => s.create)
  const [newMemory, setNewMemory] = React.useState("")

  if (!agent) return <div className="p-6"><EmptyState title={t("agents.notFound")} action={<NeonButton onClick={() => openNewSession({ kind: "repo-agent" })}>{t("agents.create")}</NeonButton>} /></div>
  const p = agent.gatewayProfile
  const ref = modelRef(agent.providerId, agent.modelId)

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-6 p-6">
      <PageHeader
        eyebrow={t("agents.title")}
        title={<span className="flex items-center gap-3"><ModelLogo modelRef={ref} size={22} />{agent.name}<TacticalChip tone={agent.status === "working" ? "cyan" : agent.status === "error" ? "danger" : "neutral"} dot pulse={agent.status === "working"}>{t(`agents.status.${agent.status}` as const)}</TacticalChip></span>}
        description={<span className="mono flex items-center gap-1.5 text-xs"><FolderGit2 className="size-3.5" />{agent.repoPath}</span>}
        actions={
          <>
            <NeonButton variant="outline" onClick={() => { void (async () => { const b = await getBackend(); if (await b.confirm(t("agents.deleteConfirm"))) { void remove(agent.id); navigate("/agents") } })() }}><Trash2 />{t("common.delete")}</NeonButton>
            <NeonButton variant="outline" onClick={async () => { const c = await createChat({ kind: "repo-agent", providerId: agent.providerId, modelId: agent.modelId, repoAgentId: agent.id, repoPath: agent.repoPath, gatewayPrompt: agent.gatewayPrompt, title: agent.name }); navigate(`/chat/${c.id}`) }}><MessageSquare />{t("agents.openChat")}</NeonButton>
            <NeonButton onClick={() => navigate(`/code?agent=${agent.id}`)}><Zap />{t("agents.launchCode")}</NeonButton>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <GlowCard tone="cyan" className="flex flex-col gap-4">
            <GatewayEditor key={`${agent.id}:${agent.gatewayPrompt}`} initial={agent.gatewayPrompt} role={p.role} summary={p.summary} onSave={(g) => void update(agent.id, { gatewayPrompt: g })} />
            <div className="grid gap-4 md:grid-cols-2">
              <div><div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("agents.behavior")}</div><div className="flex flex-wrap gap-1">{p.behaviorProfile.length ? p.behaviorProfile.map((x) => <TacticalChip key={x} size="xs" tone="cyan">{humanTrait(x)}</TacticalChip>) : <span className="text-xs text-text-3">{t("agents.defaults")}</span>}</div></div>
              <div><div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("agents.context")}</div><div className="flex flex-wrap gap-1">{p.contextPriority.map((c) => <TacticalChip key={c} size="xs">{c}</TacticalChip>)}</div></div>
              <div><div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("agents.guardrails")}</div><ul className="flex flex-col gap-1 text-xs text-text-2">{p.guardrails.length ? p.guardrails.map((g) => <li key={g} className="flex gap-1.5"><span className="text-cyan">›</span>{g}</li>) : <li className="text-text-3">{t("agents.noneDerived")}</li>}</ul></div>
              <div><div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("agents.quality")}</div><ul className="flex flex-col gap-1 text-xs text-text-2">{p.qualityExpectations.map((q) => <li key={q} className="flex gap-1.5"><span className="text-success">✓</span>{q}</li>)}</ul></div>
            </div>
          </GlowCard>
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow={t("agents.permissions")} title={t("agents.permissionsHint")} />
            <div className="grid gap-2 md:grid-cols-2">
              {PERMS.map((k) => <PermissionToggle key={k} label={t(`agents.permLabels.${k}` as const)} description={t(`agents.permDesc.${k}` as const)} checked={agent.permissions[k]} danger={DANGER.includes(k)} onCheckedChange={(v) => void setPermission(agent.id, k, v)} />)}
            </div>
          </GlowCard>
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow={t("agents.history")} title={`${agent.lastActions.length}`} />
            <ul className="flex flex-col divide-y divide-line">
              {agent.lastActions.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  {a.ok ? <CheckCircle2 className="size-3.5 shrink-0 text-success" /> : <XCircle className="size-3.5 shrink-0 text-danger" />}
                  <div className="min-w-0 flex-1"><div className="truncate text-sm">{a.title}</div>{a.detail && <div className="truncate text-[11px] text-text-3">{a.detail}</div>}</div>
                  <span className="mono text-[10px] text-text-3">{formatRelative(a.at)}</span>
                </li>
              ))}
              {agent.lastActions.length === 0 && <li className="text-xs text-text-3">{t("common.none")}</li>}
            </ul>
          </GlowCard>
        </div>
        <div className="flex flex-col gap-6">
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow={t("agents.routing")} title={t("agents.primary")} />
            <ModelPicker providerId={agent.providerId} modelId={agent.modelId} onChange={(pid, mid) => void update(agent.id, { providerId: pid, modelId: mid })} />
            <KeyValueList items={[{ label: t("agents.fallbacks"), value: agent.fallbackModelRefs.length ? <span className="flex flex-wrap justify-end gap-2">{agent.fallbackModelRefs.map((f) => <ModelTag key={f} modelRef={f} size="xs" />)}</span> : t("common.none") }, { label: t("agents.style"), value: p.taskStyle }, { label: t("agents.focus"), value: p.focusKinds.join(", ") || t("agents.any") }]} />
          </GlowCard>
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow={t("agents.tools")} title="" />
            <div className="flex flex-wrap gap-1.5">{agent.toolsEnabled.map((x) => <TacticalChip key={x} tone="cyan"><Wrench className="size-3" />{x}</TacticalChip>)}</div>
            <div className="flex items-center gap-2 text-[11px] text-text-3"><Shield className="size-3" />{t("agents.sandbox")}: <span className="mono text-text-2">{agent.permissions.write ? "workspace-write" : "read-only"}</span> · {t("agents.approvals")}: <span className="mono text-text-2">never</span></div>
          </GlowCard>
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow={t("agents.memory")} title={t("agents.memoryN", { n: memory.length })} />
            <ul className="flex flex-col gap-2">
              {memory.map((m) => (
                <li key={m.id} className={cn("group rounded-lg border border-line bg-ink-2/60 px-3 py-2")}>
                  <div className="flex items-start gap-2"><div className="min-w-0 flex-1 text-sm">{m.title}</div><button type="button" onClick={() => void removeMemory(m.id)} className="text-text-3 opacity-0 group-hover:opacity-100 hover:text-danger"><X className="size-3.5" /></button></div>
                  {m.body && <div className="line-clamp-2 text-[11px] text-text-3">{m.body}</div>}
                </li>
              ))}
              {memory.length === 0 && <li className="text-xs text-text-3">{t("agents.memoryEmpty")}</li>}
            </ul>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = newMemory.trim(); if (!v) return; void addMemory({ layer: "repo", scopeId: agent.id, scopeLabel: agent.name, tags: [], title: v, body: "", source: "manual", pinned: false }); setNewMemory("") }}>
              <Input value={newMemory} onChange={(e) => setNewMemory(e.target.value)} placeholder={t("agents.addMemory")} className="h-8 border-line bg-ink-2 text-xs" />
              <NeonButton size="sm" type="submit" variant="outline"><Plus /></NeonButton>
            </form>
          </GlowCard>
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow={t("agents.sessions")} title={t("agents.sessionsN", { n: runs.length })} />
            <ul className="flex flex-col gap-1.5">
              {runs.slice(0, 6).map((r) => (
                <li key={r.id}><button type="button" onClick={() => navigate(`/code/${r.id}`)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-ink-3/60"><GitBranch className="size-3.5 text-text-3" /><span className="min-w-0 flex-1 truncate text-sm">{r.title}</span><RunStatusBadge status={r.status} size="xs" label={t(`code.runStatus.${r.status as RunStatus}` as const)} /></button></li>
              ))}
              {runs.length === 0 && <li className="flex items-center gap-2 text-xs text-text-3"><Brain className="size-3" />{t("agents.sessionsEmpty")}</li>}
            </ul>
          </GlowCard>
        </div>
      </div>
    </div>
  )
}
