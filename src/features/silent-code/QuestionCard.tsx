import * as React from "react"
import { HelpCircle, Send } from "lucide-react"
import { GlowCard, NeonButton } from "@/design-system"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/i18n"

/** A question from the planner or from a running worker, with an answer box. */
export function QuestionCard({ title, question, why, options, onAnswer, onSkip, hint }: { title: string; question: string; why?: string; options?: string[]; onAnswer: (text: string) => void; onSkip?: () => void; hint?: string }) {
  const t = useT()
  const [text, setText] = React.useState("")
  return (
    <GlowCard tone="warn" className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-warn/50 text-warn"><HelpCircle className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{title}</div>
          <div className="mt-1 text-sm text-text-1">{question}</div>
          {why && <div className="mt-1 text-[11px] text-text-3">{t("code.rationale")}: {why}</div>}
          {hint && <div className="mt-1 text-[11px] text-text-3">{hint}</div>}
        </div>
      </div>
      {options && options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => <button key={o} type="button" onClick={() => onAnswer(o)} className="rounded-sm border border-line px-2 py-1 text-xs text-text-2 hover:border-text-2 hover:text-text-1">{o}</button>)}
        </div>
      )}
      <div className="flex items-end gap-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={t("code.answerPh")} className="min-h-[40px] flex-1 border-line bg-ink-0 text-sm" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim()) { onAnswer(text.trim()); setText("") } } }} />
        <NeonButton size="sm" disabled={!text.trim()} onClick={() => { onAnswer(text.trim()); setText("") }}><Send />{t("code.send")}</NeonButton>
        {onSkip && <NeonButton size="sm" variant="ghost" onClick={onSkip}>{t("code.skip")}</NeonButton>}
      </div>
    </GlowCard>
  )
}
