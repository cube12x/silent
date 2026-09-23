import * as React from "react"
import { cn } from "cn"
import { FileCode2, GitBranch, ListChecks, RotateCcw, ScrollText, Terminal, Square, Sparkles } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useUiStore } from "@/stores/ui"
import { useRunsStore } from "@/stores/runs"
import { KeyValueList, ModelLogo, ModelTag, NeonButton, StatusBadge, TacticalChip, TerminalView, KIND_LABEL, ProgressBar } from "@/design-system"
import { formatDuration, formatRelative } from "@/lib/format"
import { MODEL_BY_ID } from "@/engine/capabilities"

const EMPTY_LINES: never[] = []

/** Drawer opened from a worker card: everything Silent gave the worker and everything it produced. */
export function TerminalDrawer() {
  const drawer = useUiStore((s) => s.drawer)
  const close = useUiStore((s) => s.closeDrawer)
  const run = useRunsStore((s) => s.byId(drawer?.runId))
  const storedLines = useRunsStore((s) => (drawer ? s.terminal[drawer.subtaskId] : undefined))
  const lines = storedLines ?? EMPTY_LINES
  const loadTerminal = useRunsStore((s) => s.loadTerminal)
  const cancel = useRunsStore((s) => s.cancel)
  const subtask = run?.plan.find((s) => s.id === drawer?.subtaskId)
  const routing = run?.routing.find((r) => r.subtaskId === subtask?.id)

  React.useEffect(() => {
    if (drawer) void loadTerminal(drawer.runId, drawer.subtaskId)
  }, [drawer, loadTerminal])

  const live = !!subtask && ["planning", "thinking", "coding", "testing", "reviewing"].includes(subtask.state)
  const model = subtask?.assignedModelId ? MODEL_BY_ID[subtask.assignedModelId] : undefined
  const brief = subtask
    ? [`Task: ${subtask.title}`, subtask.description, run?.repoPath ? `Repository: ${run.repoPath}` : "", `Sandbox: ${model?.executable ? "workspace-write (Codex CLI)" : "simulated"}`, "Report a concise summary of what you changed and how you verified it."].filter(Boolean)
    : []

  return (
    <Sheet open={!!drawer} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="flex w-[min(880px,92vw)] flex-col gap-0 border-line bg-ink-1 p-0 sm:max-w-none">
        {subtask && run ? (
          <>
            <SheetHeader className="border-b border-line px-5 py-4">
              <div className="flex items-start gap-3">
                {subtask.assignedModelId ? <ModelLogo modelId={subtask.assignedModelId} size={20} /> : <span className="size-[30px] rounded-lg border border-dashed border-line-strong" />}
                <div className="min-w-0 flex-1">
                  <SheetTitle className="flex items-center gap-2 font-heading text-base">{model?.displayName ?? "Unassigned"} <span className="text-text-3">·</span> {KIND_LABEL[subtask.kind]} worker <StatusBadge state={subtask.state} size="xs" /></SheetTitle>
                  <SheetDescription className="truncate text-xs text-text-3">{subtask.title}</SheetDescription>
                  <ProgressBar value={subtask.progress} active={live} className="mt-2" tone={subtask.state === "failed" ? "danger" : subtask.state === "completed" ? "success" : "cyan"} />
                </div>
                {live && run.status === "running" && <NeonButton variant="outline" size="sm" onClick={() => cancel(run.id)} className="border-danger/40 text-danger"><Square />Cancel run</NeonButton>}
              </div>
            </SheetHeader>

            <Tabs defaultValue="terminal" className="flex min-h-0 flex-1 flex-col">
              <TabsList className="mx-5 mt-3 h-8 w-fit bg-ink-2">
                <TabsTrigger value="commands" className="text-xs"><Terminal className="size-3" />Commands</TabsTrigger>
                <TabsTrigger value="terminal" className="text-xs"><ScrollText className="size-3" />Terminal</TabsTrigger>
                <TabsTrigger value="files" className="text-xs"><FileCode2 className="size-3" />Files</TabsTrigger>
                <TabsTrigger value="summary" className="text-xs"><Sparkles className="size-3" />Summary</TabsTrigger>
                <TabsTrigger value="retries" className="text-xs"><RotateCcw className="size-3" />Retries</TabsTrigger>
                <TabsTrigger value="fallback" className="text-xs"><GitBranch className="size-3" />Fallback</TabsTrigger>
              </TabsList>

              <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
                <TabsContent value="commands" className="flex flex-col gap-4">
                  <div>
                    <div className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">Brief Silent gave the worker</div>
                    <pre className="mono rounded-lg border border-line bg-ink-0 p-3 text-[12px] leading-5 whitespace-pre-wrap text-text-2">{brief.join("\n\n")}</pre>
                  </div>
                  <div>
                    <div className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">Commands executed ({subtask.commands.length})</div>
                    {subtask.commands.length ? (
                      <ul className="flex flex-col gap-1">{subtask.commands.map((c, i) => <li key={i} className="mono rounded-md border border-line bg-ink-0 px-3 py-1.5 text-[12px] text-text-1">$ {c}</li>)}</ul>
                    ) : <div className="text-xs text-text-3">No commands yet.</div>}
                  </div>
                </TabsContent>
                <TabsContent value="terminal" className="h-full">
                  <TerminalView lines={lines} live={live} className="h-[calc(100vh-260px)] min-h-[320px]" emptyText={subtask.state === "waiting" ? "Worker has not started — waiting on dependencies." : "No output captured."} />
                </TabsContent>
                <TabsContent value="files">
                  <div className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">Files touched ({subtask.files.length})</div>
                  {subtask.files.length ? (
                    <ul className="flex flex-col gap-1">{subtask.files.map((f) => <li key={f} className="mono flex items-center gap-2 rounded-md border border-line bg-ink-0 px-3 py-1.5 text-[12px] text-text-1"><FileCode2 className="size-3.5 text-cyan" />{f}</li>)}</ul>
                  ) : <div className="text-xs text-text-3">No files touched yet.</div>}
                </TabsContent>
                <TabsContent value="summary" className="flex flex-col gap-4">
                  <KeyValueList items={[{ label: "State", value: <StatusBadge state={subtask.state} size="xs" /> }, { label: "Model", value: subtask.assignedModelId ? <ModelTag modelId={subtask.assignedModelId} size="xs" /> : "—" }, { label: "Attempts", value: subtask.attempts.length }, { label: "Last update", value: formatRelative(subtask.lastUpdate) }, { label: "Depends on", value: subtask.dependsOn.map((d) => KIND_LABEL[run.plan.find((s) => s.id === d)?.kind ?? "docs"]).join(", ") || "nothing" }]} />
                  <div>
                    <div className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">Task summary (safe, no hidden reasoning)</div>
                    <div className={cn("rounded-lg border p-3 text-sm", subtask.summary ? "border-line bg-ink-2/60 text-text-1" : "border-dashed border-line-strong text-text-3")}>{subtask.summary ?? "The worker has not reported yet."}</div>
                  </div>
                </TabsContent>
                <TabsContent value="retries">
                  <div className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">Attempt history</div>
                  {subtask.attempts.length ? (
                    <ol className="flex flex-col gap-2">
                      {subtask.attempts.map((a) => (
                        <li key={a.n} className={cn("rounded-lg border px-3 py-2", a.outcome === "success" ? "border-success/40" : a.outcome === "failure" ? "border-danger/40" : "border-cyan/40")}>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="mono text-text-3">#{a.n}</span>
                            <ModelTag modelId={a.modelId} size="xs" />
                            <TacticalChip size="xs" tone={a.cause === "initial" ? "neutral" : a.cause === "retry" ? "warn" : "violet"}>{a.cause}</TacticalChip>
                            <TacticalChip size="xs" tone={a.outcome === "success" ? "success" : a.outcome === "failure" ? "danger" : "cyan"} dot pulse={a.outcome === "running"}>{a.outcome}</TacticalChip>
                            <span className="mono ml-auto text-[10px] text-text-3">{a.finishedAt ? formatDuration(a.finishedAt - a.startedAt) : "running"}</span>
                          </div>
                          {a.error && <div className="mono mt-1 text-[11px] text-danger">{a.error}</div>}
                        </li>
                      ))}
                    </ol>
                  ) : <div className="text-xs text-text-3">No attempts yet.</div>}
                </TabsContent>
                <TabsContent value="fallback" className="flex flex-col gap-3">
                  <div className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">Routing decision</div>
                  {routing && (
                    <div className="rounded-lg border border-line bg-ink-2/60 p-3 text-sm">
                      <div className="flex items-center gap-2"><ListChecks className="size-3.5 text-cyan" />Primary: {routing.primaryModelId ? <ModelTag modelId={routing.primaryModelId} size="xs" /> : "none"} <span className="mono ml-auto text-[10px] text-text-3">score {routing.score}</span></div>
                      <div className="mt-1 text-[11px] text-text-3">{routing.reason}</div>
                      <div className="mt-3 text-[10px] tracking-wider text-text-3 uppercase">Fallback chain</div>
                      <ol className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        {routing.fallbackModelIds.length ? routing.fallbackModelIds.map((f, i) => <li key={f} className="flex items-center gap-2">{i > 0 && <span className="text-text-3">→</span>}<ModelTag modelId={f} size="xs" /></li>) : <li className="text-text-3">none — escalation only</li>}
                      </ol>
                      <div className="mt-3 text-[11px] text-text-3">Policy: retry once on the same model → next fallback → escalate to a higher tier in the pool → fail the subtask and block dependents.</div>
                    </div>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </>
        ) : (
          <div className="p-6 text-sm text-text-3">No worker selected.</div>
        )}
      </SheetContent>
    </Sheet>
  )
}
