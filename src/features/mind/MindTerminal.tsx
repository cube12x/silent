import * as React from "react"
import { cn } from "cn"
import type { MindModel, TerminalLine } from "@/domain"
import { TerminalView } from "@/design-system/tactical/TerminalView"
import { Input } from "@/components/ui/input"
import { useMindStore } from "@/stores/mind"
import { modelRefColor } from "@/engine/mind/colors"
import { useT } from "@/i18n"
import { useInputHistory } from "./useInputHistory"

const EMPTY: TerminalLine[] = []
const NO_SEED: string[] = []
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

export function MindTerminal({ model }: { model: MindModel }) {
  const t = useT()
  const lines = useMindStore((s) => s.terminal[model.id]) ?? EMPTY
  const busy = useMindStore((s) => s.busy[model.id])
  const run = useMindStore((s) => s.terminalRun)
  const [draft, setDraft] = React.useState("")
  const history = useInputHistory(`term:${model.id}`, NO_SEED, draft, setDraft)
  const colorOf = (stage: string) => (stage === "bilinc" ? modelRefColor(model.bilinc.modelRef) : stage === "eylem" || stage === "terminal" || stage === "memory" ? modelRefColor(model.eylem.modelRef) : undefined)
  const renderLine = (l: TerminalLine) => {
    const m = /^\[(bilinc|eylem|tek|memory|terminal)\] (.*)$/s.exec(l.text)
    const text = (m ? m[2]! : l.text).replace(ANSI, "")
    const stage = m?.[1]
    const color = stage ? colorOf(stage) : undefined
    return (
      <span className={cn("min-w-0 break-words", l.stream === "stderr" ? "text-danger" : l.stream === "system" ? "text-text-1 italic" : "text-text-2")}>
        {stage && <span className="mr-2 font-semibold" style={{ color }}>[{stage}]</span>}
        {text}
      </span>
    )
  }
  const submit = () => {
    const text = draft.trim()
    if (!text || busy === "terminal") return
    history.push(text)
    setDraft("")
    void run(model.id, text)
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="mind-terminal">
      <TerminalView lines={lines} live={busy === "terminal"} className="min-h-0 flex-1 rounded-none" emptyText={t("mind.termPh")} renderLine={renderLine} />
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (history.onKeyDown(e)) return
          if (e.key === "Enter") {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={t("mind.termPh")}
        data-testid="mind-terminal-input"
        className="mono h-8 rounded-none border-line bg-ink-2 text-[12px]"
      />
    </div>
  )
}
