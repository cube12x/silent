import * as React from "react"
import { Square } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ModelLogo, NeonButton, TerminalView } from "@/design-system"
import { useBlueprintsStore } from "@/stores/blueprints"
import { useRunsStore } from "@/stores/runs"
import { useTerminalStore } from "@/stores/terminal"
import { useT } from "@/i18n"
import type { TerminalLine } from "@/domain"

const EMPTY: TerminalLine[] = []
const LIVE_STATES = new Set(["planning", "thinking", "coding", "testing", "reviewing"])

/**
 * The terminal a node opens on four quick clicks: a single-session node shows its own lines, an orchestration node
 * shows one tab per worker task (same data as the Silent Code drawer). Stop cancels the node; Esc or four more clicks close.
 */
export function NodeTerminal({ bpId, nodeId, onClose }: { bpId: string; nodeId?: string; onClose: () => void }) {
  const t = useT()
  const node = useBlueprintsStore((s) => (nodeId ? s.byId(bpId)?.nodes.find((n) => n.id === nodeId) : undefined))
  const nodeLines = useBlueprintsStore((s) => (nodeId ? s.logs[nodeId] : undefined)) ?? EMPTY
  const running = useBlueprintsStore((s) => Boolean(nodeId && s.running[nodeId]))
  const cancel = useBlueprintsStore((s) => s.cancel)
  const runId = node?.executionId && !node.executionId.startsWith("session:") ? node.executionId : undefined
  const run = useRunsStore((s) => (runId ? s.byId(runId) : undefined))
  const loadTerminal = useRunsStore((s) => s.loadTerminal)
  const taskLines = useTerminalStore((s) => s.lines)
  React.useEffect(() => {
    if (!run) return
    for (const st of run.plan) void loadTerminal(run.id, st.id)
  }, [run, loadTerminal])
  const title = node?.data.type === "ai" && node.data.title ? node.data.title : (node?.id ?? "")
  const modelRef = node?.data.type === "ai" ? node.data.modelRef : ""
  const tasks = run?.plan ?? []
  return (
    <Sheet open={Boolean(nodeId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex flex-col gap-0 border-line bg-ink-1 p-0 data-[side=right]:w-[min(920px,92vw)] data-[side=right]:sm:max-w-none">
        <SheetHeader className="border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            {modelRef ? <ModelLogo modelRef={modelRef} size={20} /> : null}
            <div className="min-w-0 flex-1">
              <SheetTitle className="font-heading text-base">{t("bp.terminal")} · {title}</SheetTitle>
              <SheetDescription className="truncate text-xs text-text-3">{[modelRef.split(":")[1], node?.status ?? "idle", t("bp.terminalHint")].filter(Boolean).join(" · ")}</SheetDescription>
            </div>
            {running && nodeId && (
              <NeonButton variant="outline" size="sm" onClick={() => void cancel(bpId, nodeId)} className="border-danger/40 text-danger"><Square />{t("bp.stop")}</NeonButton>
            )}
          </div>
        </SheetHeader>
        {tasks.length ? (
          <Tabs defaultValue="node" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-5 mt-3 h-8 w-fit max-w-[calc(100%-40px)] overflow-x-auto bg-ink-2">
              <TabsTrigger value="node" className="text-xs">{t("bp.node.ai")}</TabsTrigger>
              {tasks.map((st, i) => <TabsTrigger key={st.id} value={st.id} className="text-xs" title={st.title}>{i + 1} · {st.title.slice(0, 18)}</TabsTrigger>)}
            </TabsList>
            <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
              <TabsContent value="node" className="h-full">
                <TerminalView lines={nodeLines} live={running} className="h-[calc(100vh-200px)] min-h-[320px]" emptyText={t("bp.terminalEmpty")} />
              </TabsContent>
              {tasks.map((st) => (
                <TabsContent key={st.id} value={st.id} className="h-full">
                  <TerminalView lines={taskLines[st.id] ?? EMPTY} live={LIVE_STATES.has(st.state)} className="h-[calc(100vh-200px)] min-h-[320px]" emptyText={t("bp.terminalEmpty")} />
                </TabsContent>
              ))}
            </div>
          </Tabs>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
            <TerminalView lines={nodeLines} live={running} className="h-[calc(100vh-150px)] min-h-[320px]" emptyText={t("bp.terminalEmpty")} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
