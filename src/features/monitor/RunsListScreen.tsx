import { useNavigate } from "react-router"
import { Activity, Zap } from "lucide-react"
import { useRunsStore } from "@/stores/runs"
import { EmptyState, GlowCard, ModelTag, NeonButton, PageHeader, ProgressBar, RunStatusBadge } from "@/design-system"
import { formatRelative, formatUsd } from "@/lib/format"

export function RunsListScreen() {
  const runs = useRunsStore((s) => s.runs)
  const navigate = useNavigate()
  return (
    <div className="mx-auto flex max-w-[1920px] flex-col gap-6 p-6 2xl:p-8">
      <PageHeader eyebrow="Live monitor" title="Silent Code sessions" description="Every orchestration run, live or archived. Open one to inspect per-model workers and terminals." actions={<NeonButton onClick={() => navigate("/silent-code")}><Zap />New run</NeonButton>} />
      {runs.length === 0 ? (
        <EmptyState icon={<Activity />} title="No sessions yet" action={<NeonButton onClick={() => navigate("/silent-code")}>Launch Silent Code</NeonButton>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {runs.map((r) => {
            const pct = r.plan.length ? Math.round(r.plan.reduce((n, s) => n + s.progress, 0) / r.plan.length) : 0
            return (
              <GlowCard key={r.id} interactive active={r.status === "running"} onClick={() => navigate(`/runs/${r.id}`)} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-heading text-sm font-semibold">{r.title}</div>
                    <div className="truncate text-[11px] text-text-3">{formatRelative(r.createdAt)} · {r.executionMode} · {r.costMode}</div>
                  </div>
                  <RunStatusBadge status={r.status} size="xs" />
                </div>
                <ProgressBar value={pct} active={r.status === "running"} tone={r.status === "failed" ? "danger" : r.status === "completed" ? "success" : "cyan"} />
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-3">
                  {Array.from(new Set(r.routing.map((x) => x.primaryModelId))).slice(0, 4).map((m) => <ModelTag key={m} modelId={m} size="xs" />)}
                  <span className="mono ml-auto">{r.actual ? formatUsd(r.actual.costUsd) : `~${formatUsd(r.estimate.costUsd)}`}</span>
                </div>
              </GlowCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
