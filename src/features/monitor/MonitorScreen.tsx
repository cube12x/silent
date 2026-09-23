import * as React from "react"
import { useNavigate, useParams } from "react-router"
import { Activity, FolderGit2, Square, Zap, RotateCcw } from "lucide-react"
import { useRunsStore } from "@/stores/runs"
import { useUiStore } from "@/stores/ui"
import { AgentWorkerCard, CostMeter, EmptyState, ExecutionTimeline, GlowCard, NeonButton, PageHeader, ProgressBar, RouteGraph, RunStatusBadge, SectionHeader, TacticalChip, KIND_LABEL, ModelTag } from "@/design-system"
import { formatDuration, formatRelative } from "@/lib/format"
import { cn } from "cn"

export function MonitorScreen() {
  const { runId } = useParams()
  const navigate = useNavigate()
  const run = useRunsStore((s) => s.byId(runId))
  const usage = useRunsStore((s) => (runId ? s.usage[runId] : undefined))
  const terminal = useRunsStore((s) => s.terminal)
  const cancel = useRunsStore((s) => s.cancel)
  const draft = useRunsStore((s) => s.draft)
  const start = useRunsStore((s) => s.start)
  const openDrawer = useUiStore((s) => s.openDrawer)
  const drawer = useUiStore((s) => s.drawer)
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])

  if (!run) return <div className="p-6"><EmptyState icon={<Activity />} title="Session not found" action={<NeonButton onClick={() => navigate("/silent-code")}>Launch Silent Code</NeonButton>} /></div>

  const pct = run.plan.length ? Math.round(run.plan.reduce((n, s) => n + s.progress, 0) / run.plan.length) : 0
  const done = run.plan.filter((s) => s.state === "completed").length
  const failed = run.plan.filter((s) => s.state === "failed").length
  const activeModels = Array.from(new Set(run.plan.filter((s) => ["planning", "thinking", "coding", "testing", "reviewing"].includes(s.state)).map((s) => s.assignedModelId).filter(Boolean))) as string[]
  const elapsed = run.startedAt ? (run.finishedAt ?? now) - run.startedAt : 0

  // Activity feed derived from the run itself: newest state changes and logs.
  const feed = run.plan
    .flatMap((s) => [
      ...s.attempts.map((a) => ({ at: a.finishedAt ?? a.startedAt, text: `${KIND_LABEL[s.kind]} · attempt ${a.n} (${a.cause}) on ${a.modelId} → ${a.outcome}${a.error ? `: ${a.error}` : ""}`, ok: a.outcome === "success", running: a.outcome === "running" })),
      ...(terminal[s.id] ?? []).slice(-3).map((l) => ({ at: l.ts, text: `${KIND_LABEL[s.kind]} · ${l.text}`, ok: l.stream !== "stderr", running: false })),
    ])
    .sort((a, b) => b.at - a.at)
    .slice(0, 14)

  const rerun = async () => {
    const d = draft({ prompt: run.prompt, pool: run.modelPool, executionMode: run.executionMode, costMode: run.costMode, repoAgentId: run.repoAgentId, repoPath: run.repoPath })
    await start(d)
    navigate(`/runs/${d.id}`)
  }

  return (
    <div className="mx-auto flex max-w-[1920px] flex-col gap-6 p-6 2xl:p-8">
      <PageHeader
        eyebrow="Live monitor"
        title={<span className="flex items-center gap-3">{run.title}<RunStatusBadge status={run.status} /></span>}
        description={<span className="flex flex-wrap items-center gap-3 text-xs"><span className="mono text-text-2">“{run.prompt.length > 140 ? run.prompt.slice(0, 137) + "…" : run.prompt}”</span>{run.repoPath && <span className="mono flex items-center gap-1"><FolderGit2 className="size-3" />{run.repoPath}</span>}</span>}
        actions={
          run.status === "running" ? (
            <NeonButton variant="outline" onClick={() => cancel(run.id)} className="border-danger/40 text-danger hover:border-danger hover:text-danger"><Square />Cancel run</NeonButton>
          ) : (
            <>
              <NeonButton variant="outline" onClick={rerun}><RotateCcw />Re-run</NeonButton>
              <NeonButton onClick={() => navigate("/silent-code")}><Zap />New run</NeonButton>
            </>
          )
        }
      />

      <GlowCard tone={run.status === "running" ? "cyan" : run.status === "failed" ? "danger" : run.status === "completed" ? "success" : "default"} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="font-heading text-3xl font-semibold tabular-nums">{pct}%</div>
          <div className="text-xs text-text-2">
            <div>{done}/{run.plan.length} subtasks complete{failed ? <span className="text-danger"> · {failed} failed</span> : null}</div>
            <div className="text-text-3">{run.executionMode} · {run.costMode} · {elapsed ? formatDuration(elapsed) : "not started"}{run.status === "running" ? " elapsed" : ""}</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-[10px] tracking-[0.16em] text-text-3 uppercase">active models</span>
            {activeModels.length ? activeModels.map((m) => <TacticalChip key={m} tone="cyan" dot pulse><ModelTag modelId={m} size="xs" className="text-cyan" /></TacticalChip>) : <TacticalChip>none</TacticalChip>}
          </div>
        </div>
        <ProgressBar value={pct} active={run.status === "running"} size="lg" tone={run.status === "failed" ? "danger" : run.status === "completed" ? "success" : "cyan"} />
      </GlowCard>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <section>
            <SectionHeader eyebrow="Workers" title="Per-model status" description="Click a card to inspect its terminal, commands, files and retry history." className="mb-3" />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {run.plan.map((s) => <AgentWorkerCard key={s.id} subtask={s} now={now} selected={drawer?.subtaskId === s.id} onOpen={() => openDrawer(run.id, s.id)} />)}
            </div>
          </section>
          <section>
            <SectionHeader eyebrow="Routing" title="Task → model graph" className="mb-3" />
            <GlowCard><RouteGraph plan={run.plan} routing={run.routing} onSelectSubtask={(id) => openDrawer(run.id, id)} selectedSubtaskId={drawer?.subtaskId} /></GlowCard>
          </section>
        </div>
        <div className="flex flex-col gap-6">
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="Cost" title="Tokens & spend" />
            <CostMeter tokens={run.estimate.tokens} costUsd={run.estimate.costUsd} seconds={run.estimate.seconds} actual={run.actual ?? (usage && usage.tokens ? { tokens: usage.tokens, costUsd: usage.costUsd } : undefined)} />
          </GlowCard>
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="Timeline" title="Task progress" />
            <ExecutionTimeline plan={run.plan} selectedId={drawer?.subtaskId} onSelect={(id) => openDrawer(run.id, id)} />
          </GlowCard>
          <GlowCard className="flex flex-col gap-3">
            <SectionHeader eyebrow="Feed" title="Activity" />
            <ul className="flex flex-col gap-1.5">
              {feed.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px]">
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", f.running ? "animate-pulse-soft bg-cyan" : f.ok ? "bg-success/70" : "bg-danger/70")} />
                  <span className="min-w-0 flex-1 truncate text-text-2">{f.text}</span>
                  <span className="mono shrink-0 text-text-3">{formatRelative(f.at, now)}</span>
                </li>
              ))}
              {feed.length === 0 && <li className="text-xs text-text-3">Waiting for workers…</li>}
            </ul>
          </GlowCard>
        </div>
      </div>
    </div>
  )
}
