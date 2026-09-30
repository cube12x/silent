import * as React from "react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { NeonButton } from "@/design-system"
import { ModelPicker } from "@/features/chat/ModelPicker"
import { modelRef, parseModelRef, type Blueprint, type ProviderId, type TamirciPreset } from "@/domain"
import { useBlueprintsStore } from "@/stores/blueprints"
import { useFilesStore } from "@/stores/files"
import { useNotifyStore, reportError } from "@/stores/notify"
import { useProvidersStore, selectAvailableModels } from "@/stores/providers"
import { getBackend } from "@/services"
import { useT } from "@/i18n"

export interface TamirciTarget {
  /** Suggested file list (the clicked item's files). */
  files: string[]
  /** Human label of what was clicked (item title, category, file). */
  label: string
}

/** "Tamirci AI çağır": model + repos + problem + files → the repair box runs; the tab shows the report afterwards. */
export function TamirciDialog({ bp, buildNodeId, root, target, onClose }: { bp: Blueprint; buildNodeId: string; root: string; target: TamirciTarget | null; onClose: () => void }) {
  const t = useT()
  const providers = useProvidersStore((s) => s.providers)
  const unavailable = useProvidersStore((s) => s.unavailable)
  const models = React.useMemo(() => selectAvailableModels(providers, unavailable), [providers, unavailable])
  const preset: TamirciPreset | undefined = bp.meta?.tamirci
  // Default model: the saved preset, else the strongest-looking installed model (opus > sonnet/gpt > first).
  const strongest = models.find((m) => /opus/i.test(m.id)) ?? models.find((m) => /sonnet|gpt-5|gpt-6/i.test(m.id)) ?? models[0]
  const defaultRef = preset?.modelRef || (strongest ? modelRef(strongest.providerId, strongest.id) : "")
  const [ref, setRef] = React.useState(defaultRef || "")
  const [instructions, setInstructions] = React.useState(preset?.instructions ?? "")
  const [repos, setRepos] = React.useState((preset?.repos ?? []).map((r) => r.url).join("\n"))
  const [problem, setProblem] = React.useState("")
  const [files, setFiles] = React.useState<string[]>(target?.files ?? [])
  const [extra, setExtra] = React.useState("")
  const [bilinc, setBilinc] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const { providerId, modelId } = parseModelRef(ref || "codex:")
  const submit = async () => {
    if (!problem.trim() || !ref || busy) return
    setBusy(true)
    const req = {
      problem: problem.trim(),
      files,
      bilinc,
      preset: { modelRef: ref, instructions: instructions.trim() || undefined, repos: repos.split("\n").map((u) => u.trim()).filter(Boolean).map((url) => ({ url })), effort: preset?.effort },
    }
    const startedAt = Date.now()
    onClose()
    try {
      useNotifyStore.getState().push("info", t("files.tamirci.started", { node: bilinc ? "Bilinç → Eylem" : "Tamirci AI" }))
      const { nodeId } = await useBlueprintsStore.getState().callTamirci(bp.id, buildNodeId, req)
      const backend = await getBackend()
      const changed = await backend.changedFiles(root, startedAt)
      const node = useBlueprintsStore.getState().byId(bp.id)?.nodes.find((n) => n.id === nodeId)
      useFilesStore.getState().setLastFix(root, { at: Date.now(), changed, report: node?.data.type === "ai" ? node.data.report : undefined, nodeId })
      void useFilesStore.getState().checkStale(root)
    } catch (e) {
      reportError(e, "tamirci")
    } finally {
      setBusy(false)
    }
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !(e.target instanceof HTMLTextAreaElement && e.target.name === "instructions"))) {
      if (e.target instanceof HTMLTextAreaElement && e.target.name === "problem" && e.shiftKey) return
      e.preventDefault()
      void submit()
    }
  }
  return (
    <Sheet open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-[440px] flex-col gap-3 overflow-y-auto sm:max-w-[440px]" onKeyDown={onKey}>
        <SheetHeader>
          <SheetTitle>{t("files.tamirci.title")}</SheetTitle>
          <SheetDescription>{t("files.tamirci.subtitle")} · {target?.label}</SheetDescription>
        </SheetHeader>
        <label className="flex flex-col gap-1 text-xs text-text-3">{t("files.tamirci.model")}
          <ModelPicker providerId={(providerId || "codex") as ProviderId} modelId={modelId} onChange={(p, m) => setRef(modelRef(p, m))} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-3">{t("files.tamirci.problem")}
          <Textarea name="problem" autoFocus value={problem} onChange={(e) => setProblem(e.target.value)} rows={4} placeholder={t("files.tamirci.problemPlaceholder")} className="text-[12px]" />
        </label>
        <div className="flex flex-col gap-1 text-xs text-text-3">
          <span>{t("files.tamirci.files")} ({files.length})</span>
          <div className="max-h-40 overflow-auto rounded-sm border border-line bg-ink-0 p-1">
            {files.map((f) => (
              <label key={f} className="mono flex items-center gap-2 px-1 py-0.5 text-[11px] text-text-2">
                <input type="checkbox" checked readOnly onClick={() => setFiles((cur) => cur.filter((x) => x !== f))} /> {f}
              </label>
            ))}
            {!files.length && <div className="px-1 py-0.5 text-[11px] text-text-3">—</div>}
          </div>
          <div className="flex gap-1">
            <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="src/…" className="h-7 flex-1 text-[11px]" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (extra.trim()) { setFiles((cur) => Array.from(new Set([...cur, extra.trim()]))); setExtra("") } } }} />
            <NeonButton size="sm" variant="outline" onClick={() => { if (extra.trim()) { setFiles((cur) => Array.from(new Set([...cur, extra.trim()]))); setExtra("") } }}>+</NeonButton>
          </div>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-text-2">
          <input type="checkbox" checked={bilinc} onChange={(e) => setBilinc(e.target.checked)} /> {t("files.tamirci.bilinc")}
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-3">{t("files.tamirci.instructions")}
          <Textarea name="instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} placeholder={t("files.tamirci.instructionsPlaceholder")} className="text-[12px]" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-3">{t("files.tamirci.repos")}
          <Textarea value={repos} onChange={(e) => setRepos(e.target.value)} rows={2} placeholder="https://github.com/owner/repo" className="mono text-[11px]" />
        </label>
        <NeonButton onClick={() => void submit()} disabled={!problem.trim() || !ref || busy}>{t("files.tamirci.run")}</NeonButton>
      </SheetContent>
    </Sheet>
  )
}
