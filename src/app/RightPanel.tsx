import { useParams, useLocation } from "react-router"
import { Brain, GitBranch, Layers, ListTree, ScrollText, Wallet } from "lucide-react"
import { useRunsStore } from "@/stores/runs"
import { useChatsStore } from "@/stores/chats"
import { useAgentsStore } from "@/stores/agents"
import { useMemoryStore } from "@/stores/memory"
import { useSettingsStore } from "@/stores/settings"
import { useProvidersStore } from "@/stores/providers"
import { useUiStore } from "@/stores/ui"
import { CostMeter, ExecutionTimeline, KeyValueList, ModelTag, RouteGraph, SectionHeader, TacticalChip, TerminalView } from "@/design-system"
import { COST_MODE_LABELS } from "@/domain"
import { formatTokens, shortPath } from "@/lib/format"
import { ScrollArea } from "@/components/ui/scroll-area"

function Block({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase [&_svg]:size-3">
        {icon}
        {title}
      </div>
      {children}
    </section>
  )
}

/** Collapsible intelligence panel: shows what matters for the current route. */
export function RightPanel() {
  const params = useParams()
  const { pathname } = useLocation()
  const run = useRunsStore((s) => s.byId(params.runId))
  const usage = useRunsStore((s) => (params.runId ? s.usage[params.runId] : undefined))
  const terminal = useRunsStore((s) => s.terminal)
  const chat = useChatsStore((s) => s.byId(params.chatId))
  const messages = useChatsStore((s) => (params.chatId ? s.messages[params.chatId] : undefined))
  const agent = useAgentsStore((s) => s.byId(params.agentId ?? run?.repoAgentId ?? chat?.repoAgentId))
  const memory = useMemoryStore((s) => s.entries)
  const settings = useSettingsStore((s) => s.settings)
  const providers = useProvidersStore((s) => s.providers)
  const openDrawer = useUiStore((s) => s.openDrawer)

  const scopedMemory = agent ? memory.filter((m) => m.scopeId === agent.id) : memory.filter((m) => m.layer === "user")
  const activeSubtask = run?.plan.find((s) => ["planning", "thinking", "coding", "testing", "reviewing"].includes(s.state))

  return (
    <ScrollArea className="h-full">
      <div className="px-4 pt-3 pb-2">
        <SectionHeader eyebrow="Intelligence" title={run ? "Execution plan" : chat ? "Chat context" : agent ? "Agent context" : "Workspace"} size="sm" />
      </div>

      {run && (
        <>
          <Block icon={<ListTree />} title="Task graph">
            <RouteGraph plan={run.plan} routing={run.routing} height={Math.max(run.plan.length, 4) * 30 + 16} onSelectSubtask={(id) => openDrawer(run.id, id)} />
          </Block>
          <Block icon={<Layers />} title="Selected models">
            <div className="flex flex-wrap gap-1.5">
              {run.modelPool.map((id) => (
                <span key={id} className="rounded-md border border-line bg-ink-2 px-1.5 py-1">
                  <ModelTag modelId={id} size="xs" />
                </span>
              ))}
            </div>
          </Block>
          <Block icon={<Wallet />} title="Token / cost">
            <CostMeter tokens={run.estimate.tokens} costUsd={run.estimate.costUsd} seconds={run.estimate.seconds} actual={run.actual ?? (usage && usage.tokens ? { tokens: usage.tokens, costUsd: usage.costUsd } : undefined)} compact />
          </Block>
          <Block icon={<GitBranch />} title="Execution timeline">
            <ExecutionTimeline plan={run.plan} onSelect={(id) => openDrawer(run.id, id)} />
          </Block>
          {activeSubtask && (
            <Block icon={<ScrollText />} title="Live log">
              <TerminalView lines={(terminal[activeSubtask.id] ?? []).slice(-60)} live className="h-48" />
            </Block>
          )}
        </>
      )}

      {chat && (
        <>
          <Block icon={<Layers />} title="Model">
            <KeyValueList items={[{ label: "Model", value: <ModelTag modelId={chat.modelId} size="xs" /> }, { label: "Kind", value: chat.kind }, ...(chat.repoPath ? [{ label: "Repo", value: shortPath(chat.repoPath), mono: true }] : []), ...(chat.codexThreadId ? [{ label: "Thread", value: chat.codexThreadId.slice(0, 18), mono: true }] : [])]} />
          </Block>
          {chat.gatewayProfile && (
            <Block icon={<GitBranch />} title="Gateway">
              <div className="text-xs text-text-2">{chat.gatewayProfile.summary}</div>
              <ul className="mt-2 flex flex-col gap-1">
                {chat.gatewayProfile.guardrails.slice(0, 4).map((g) => (
                  <li key={g} className="flex gap-2 text-[11px] text-text-3"><span className="text-cyan">›</span>{g}</li>
                ))}
              </ul>
            </Block>
          )}
          <Block icon={<Wallet />} title="Token usage">
            <CostMeter tokens={(messages ?? []).reduce((n, m) => n + (m.usage?.totalTokens ?? 0), 0)} costUsd={0} compact />
            <div className="mt-1 text-[10px] text-text-3">Cost tracked per provider once API pricing is connected.</div>
          </Block>
        </>
      )}

      {agent && !run && (
        <Block icon={<Layers />} title="Agent">
          <KeyValueList items={[{ label: "Primary", value: <ModelTag modelId={agent.primaryModelId} size="xs" /> }, { label: "Fallbacks", value: agent.fallbackModelIds.length }, { label: "Role", value: agent.gatewayProfile.role }, { label: "Style", value: agent.gatewayProfile.taskStyle }]} />
        </Block>
      )}

      {!run && !chat && !agent && (
        <>
          <Block icon={<Layers />} title="Routing defaults">
            <KeyValueList items={[{ label: "Primary", value: <ModelTag modelId={settings.defaultPrimaryModelId} size="xs" /> }, { label: "Fallback", value: <ModelTag modelId={settings.defaultFallbackModelId} size="xs" /> }, { label: "Cost mode", value: COST_MODE_LABELS[settings.costMode] }, { label: "Providers", value: `${providers.filter((p) => p.enabled).length}/${providers.length} enabled` }]} />
          </Block>
          <Block icon={<Wallet />} title="Today">
            <CostMeter tokens={useRunsStore.getState().runs.reduce((n, r) => n + (r.actual?.tokens ?? 0), 0)} costUsd={useRunsStore.getState().runs.reduce((n, r) => n + (r.actual?.costUsd ?? 0), 0)} compact />
          </Block>
        </>
      )}

      <Block icon={<Brain />} title={agent ? `Repo memory · ${agent.name}` : "User memory"}>
        {scopedMemory.length === 0 ? (
          <div className="text-[11px] text-text-3">No memories in scope.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {scopedMemory.slice(0, 5).map((m) => (
              <li key={m.id} className="rounded-md border border-line bg-ink-2/60 px-2 py-1.5">
                <div className="truncate text-[12px] font-medium text-text-1">{m.title}</div>
                <div className="line-clamp-2 text-[11px] text-text-3">{m.body}</div>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block icon={<ScrollText />} title="Logs">
        <div className="mono flex flex-col gap-1 text-[11px] text-text-3">
          <div><span className="text-text-3/60">route</span> {pathname}</div>
          <div><span className="text-text-3/60">memory</span> {memory.length} entries · {formatTokens(memory.reduce((n, m) => n + m.body.length / 4, 0))} tok</div>
          <div><span className="text-text-3/60">providers</span> {providers.filter((p) => p.status === "connected").map((p) => p.name).join(", ") || "none real"}</div>
          <div className="flex gap-1 pt-1">
            <TacticalChip size="xs" tone="cyan">codex-native</TacticalChip>
            <TacticalChip size="xs">sandbox: workspace-write</TacticalChip>
          </div>
        </div>
      </Block>
    </ScrollArea>
  )
}
