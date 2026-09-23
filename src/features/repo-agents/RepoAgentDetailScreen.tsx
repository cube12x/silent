import * as React from "react"
import { useNavigate, useParams } from "react-router"
import { cn } from "cn"
import { Brain, FolderGit2, GitBranch, MessageSquare, Shield, Trash2, Wrench, Zap, CheckCircle2, XCircle, Save } from "lucide-react"
import { useAgentsStore } from "@/stores/agents"
import { useMemoryStore } from "@/stores/memory"
import { useUiStore } from "@/stores/ui"
import { useChatsStore } from "@/stores/chats"
import { useRunsStore } from "@/stores/runs"
import { EmptyState, GlowCard, KeyValueList, ModelLogo, ModelTag, NeonButton, PageHeader, PermissionToggle, SectionHeader, TacticalChip, RunStatusBadge, MemoryTag } from "@/design-system"
import { PERMISSION_LABELS, type PermissionKey } from "@/domain"
import { humanTrait } from "@/engine/gateway"
import { formatRelative } from "@/lib/format"
import { Textarea } from "@/components/ui/textarea"

const PERMISSION_DESC: Record<PermissionKey, string> = {
  read: "Read files in the repository",
  write: "Modify existing files (maps to Codex sandbox workspace-write)",
  runTests: "Execute the project's test suite",
  terminal: "Run shell commands inside the sandbox",
  gitCommit: "Create commits in the working tree",
  gitPush: "Push to remotes — always off by default",
  network: "Outbound network access from the sandbox",
  fileCreateDelete: "Create and delete files",
}
const DANGER: PermissionKey[] = ["gitPush", "network", "fileCreateDelete"]

function GatewayEditor({ initial, role, summary, onSave }: { initial: string; role: string; summary: string; onSave: (g: string) => void }) {
  const [gateway, setGateway] = React.useState(initial)
  const dirty = gateway !== initial
  return (
    <>
      <SectionHeader eyebrow="Gateway" title={role} description={summary} actions={dirty ? <NeonButton size="sm" onClick={() => onSave(gateway)}><Save />Re-interpret</NeonButton> : undefined} />
      <Textarea value={gateway} onChange={(e) => setGateway(e.target.value)} rows={3} className="border-line bg-ink-0/60 text-sm" />
    </>
  )
}

export function RepoAgentDetailScreen() {
  const { agentId } = useParams()
  const navigate = useNavigate()
  const agent = useAgentsStore((s) => s.byId(agentId))
  const setPermission = useAgentsStore((s) => s.setPermission)
  const update = useAgentsStore((s) => s.update)
  const remove = useAgentsStore((s) => s.remove)
  const allMemory = useMemoryStore((s) => s.entries)
  const allRuns = useRunsStore((s) => s.runs)
  const memory = React.useMemo(() => allMemory.filter((m) => m.scopeId === agentId), [allMemory, agentId])
  const runs = React.useMemo(() => allRuns.filter((r) => r.repoAgentId === agentId), [allRuns, agentId])
  const openNewSession = useUiStore((s) => s.openNewSession)
  const createChat = useChatsStore((s) => s.create)
  if (!agent) return <div className="p-6"><EmptyState title="Agent not found" action={<NeonButton onClick={() => openNewSession({ kind: "repo-agent" })}>Create repo agent</NeonButton>} /></div>
  const p = agent.gatewayProfile

  return (
    <div className="mx-auto flex max-w-[1920px] flex-col gap-6 p-6 2xl:p-8">
      <PageHeader
        eyebrow="Repo agent"
        title={
          <span className="flex items-center gap-3">
            <ModelLogo modelId={agent.primaryModelId} size={22} />
            {agent.name}
            <TacticalChip tone={agent.status === "working" ? "cyan" : agent.status === "error" ? "danger" : "neutral"} dot pulse={agent.status === "working"}>{agent.status}</TacticalChip>
          </span>
        }
        description={<span className="mono flex items-center gap-1.5 text-xs"><FolderGit2 className="size-3.5" />{agent.repoPath}</span>}
        actions={
          <>
            <NeonButton variant="outline" onClick={() => { void remove(agent.id); navigate("/agents") }}><Trash2 />Delete</NeonButton>
            <NeonButton variant="outline" onClick={async () => { const c = await createChat({ kind: "repo-agent", modelId: agent.primaryModelId, repoAgentId: agent.id, repoPath: agent.repoPath, gatewayPrompt: agent.gatewayPrompt, title: `${agent.name} · chat` }); navigate(`/chat/${c.id}`) }}><MessageSquare />Open chat</NeonButton>
            <NeonButton onClick={() => navigate(`/silent-code?agent=${agent.id}`)}><Zap />Launch Silent Code here</NeonButton>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <GlowCard tone="cyan" className="flex flex-col gap-4">
            <GatewayEditor key={`${agent.id}:${agent.gatewayPrompt}`} initial={agent.gatewayPrompt} role={p.role} summary={p.summary} onSave={(g) => void update(agent.id, { gatewayPrompt: g })} />
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">Behaviour profile</div>
                <div className="flex flex-wrap gap-1">{p.behaviorProfile.length ? p.behaviorProfile.map((t) => <TacticalChip key={t} size="xs" tone="cyan">{humanTrait(t)}</TacticalChip>) : <span className="text-xs text-text-3">defaults</span>}</div>
              </div>
              <div>
                <div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">Context priority</div>
                <div className="flex flex-wrap gap-1">{p.contextPriority.map((c) => <TacticalChip key={c} size="xs">{c}</TacticalChip>)}</div>
              </div>
              <div>
                <div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">Guardrails</div>
                <ul className="flex flex-col gap-1 text-xs text-text-2">{p.guardrails.length ? p.guardrails.map((g) => <li key={g} className="flex gap-1.5"><span className="text-cyan">›</span>{g}</li>) : <li className="text-text-3">none derived</li>}</ul>
              </div>
              <div>
                <div className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">Quality expectations</div>
                <ul className="flex flex-col gap-1 text-xs text-text-2">{p.qualityExpectations.map((q) => <li key={q} className="flex gap-1.5"><span className="text-success">✓</span>{q}</li>)}</ul>
              </div>
            </div>
          </GlowCard>

          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="Permissions" title="What this agent may do" description="Derived from the Gateway, overridable here. Write=off maps Codex to a read-only sandbox." />
            <div className="grid gap-2 md:grid-cols-2">
              {(Object.keys(PERMISSION_LABELS) as PermissionKey[]).map((k) => (
                <PermissionToggle key={k} label={PERMISSION_LABELS[k]} description={PERMISSION_DESC[k]} checked={agent.permissions[k]} danger={DANGER.includes(k)} onCheckedChange={(v) => void setPermission(agent.id, k, v)} />
              ))}
            </div>
          </GlowCard>

          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="History" title="Recent actions" />
            <ul className="flex flex-col divide-y divide-line">
              {agent.lastActions.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  {a.ok ? <CheckCircle2 className="size-3.5 shrink-0 text-success" /> : <XCircle className="size-3.5 shrink-0 text-danger" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{a.title}</div>
                    {a.detail && <div className="truncate text-[11px] text-text-3">{a.detail}</div>}
                  </div>
                  <TacticalChip size="xs">{a.kind}</TacticalChip>
                  <span className="mono text-[10px] text-text-3">{formatRelative(a.at)}</span>
                </li>
              ))}
            </ul>
          </GlowCard>
        </div>

        <div className="flex flex-col gap-6">
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="Models" title="Routing" />
            <KeyValueList items={[{ label: "Primary", value: <ModelTag modelId={agent.primaryModelId} /> }, { label: "Fallbacks", value: agent.fallbackModelIds.length ? <span className="flex flex-wrap justify-end gap-2">{agent.fallbackModelIds.map((f) => <ModelTag key={f} modelId={f} size="xs" />)}</span> : "none" }, { label: "Task style", value: p.taskStyle }, { label: "Focus", value: p.focusKinds.join(", ") || "any" }]} />
          </GlowCard>
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="Tools" title="Enabled tools" />
            <div className="flex flex-wrap gap-1.5">{agent.toolsEnabled.map((t) => <TacticalChip key={t} tone="cyan"><Wrench className="size-3" />{t}</TacticalChip>)}</div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-text-3"><Shield className="size-3" />Sandbox: <span className="mono text-text-2">{agent.permissions.write ? "workspace-write" : "read-only"}</span> · approvals: <span className="mono text-text-2">never</span></div>
          </GlowCard>
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="Memory" title={`${memory.length} repo memories`} actions={<button type="button" onClick={() => navigate("/memory")} className="flex items-center gap-1 text-xs text-text-2 hover:text-cyan"><Brain className="size-3" />Open</button>} />
            <ul className="flex flex-col gap-2">
              {memory.slice(0, 5).map((m) => (
                <li key={m.id} className={cn("rounded-lg border border-line bg-ink-2/60 px-3 py-2", m.pinned && "border-cyan/30")}>
                  <div className="flex items-center gap-2 text-sm font-medium">{m.title}{m.pinned && <TacticalChip size="xs" tone="cyan">pinned</TacticalChip>}</div>
                  <div className="line-clamp-2 text-[11px] text-text-3">{m.body}</div>
                  <div className="mt-1 flex gap-1">{m.tags.map((t) => <MemoryTag key={t} tag={t} layer="repo" />)}</div>
                </li>
              ))}
              {memory.length === 0 && <li className="text-xs text-text-3">Nothing learned yet.</li>}
            </ul>
          </GlowCard>
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="Silent Code" title={`${runs.length} sessions`} />
            <ul className="flex flex-col gap-1.5">
              {runs.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => navigate(`/runs/${r.id}`)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-ink-3/60">
                    <GitBranch className="size-3.5 text-text-3" />
                    <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                    <RunStatusBadge status={r.status} size="xs" />
                  </button>
                </li>
              ))}
              {runs.length === 0 && <li className="text-xs text-text-3">No sessions yet.</li>}
            </ul>
          </GlowCard>
        </div>
      </div>
    </div>
  )
}
