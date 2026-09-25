import { CheckCircle2, AlertTriangle, HelpCircle, Info } from "lucide-react"
import type { RunReport as Report } from "@/domain"
import { GlowCard, SectionHeader } from "@/design-system"
import { useT } from "@/i18n"

/** Rough category of a deviation line: environment limit, something not done, or a changed decision. */
function classifyDeviation(text: string): "env" | "undone" | "changed" {
  const t = text.toLowerCase()
  if (/(sandbox|browser|chromium|playwright|network|permission|tarayıcı|ağ)/.test(t) && /(unavailable|not available|could not|cannot|unable|not attempted|blocked|denied|yapılamadı|yapılmadı|kısıt)/.test(t)) return "env"
  if (/(did not|didn't|could not|couldn't|cannot|unable|skipped|not (run|done|implemented|verified|tested|added)|remain(s)? (unverified|incomplete)|yapılmadı|yapılamadı|atlandı|eksik)/.test(t)) return "undone"
  return "changed"
}

function Section({ icon, title, items, tone, none, badge }: { icon: React.ReactNode; title: string; items: string[]; tone: string; none: string; badge?: (item: string) => string }) {
  return (
    <div>
      <div className={`mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] uppercase ${tone}`}>{icon}{title}</div>
      {items.length ? <ul className="flex flex-col gap-1 text-xs text-text-2">{items.map((x, i) => <li key={i} className="flex gap-1.5"><span className="text-text-3">›</span>{badge ? <span className="mono mr-1 shrink-0 rounded-sm border border-line px-1 text-[10px] text-text-3">{badge(x)}</span> : null}<span className="min-w-0">{x}</span></li>)}</ul> : <div className="text-xs text-text-3">{none}</div>}
    </div>
  )
}

export function RunReport({ report }: { report: Report }) {
  const t = useT()
  const none = t("code.reportNone")
  return (
    <GlowCard tone={report.deviations.length || report.openQuestions.length ? "warn" : "success"} className="flex flex-col gap-4">
      <SectionHeader eyebrow={t("code.report")} title={report.polishScore !== undefined ? `${t("code.reportPolish")}: ${report.polishScore}/10` : ""} description={report.polishNotes} />
      <Section icon={<CheckCircle2 className="size-3" />} title={t("code.reportDone")} items={report.done} tone="text-success" none={none} />
      <Section icon={<AlertTriangle className="size-3" />} title={t("code.reportDeviations")} items={report.deviations} tone="text-warn" none={none} badge={(x) => t(`code.dev.${classifyDeviation(x)}` as const)} />
      {report.notes?.length ? <Section icon={<Info className="size-3" />} title={t("code.reportNotes")} items={report.notes} tone="text-text-2" none={none} /> : null}
      <Section icon={<HelpCircle className="size-3" />} title={t("code.reportOpen")} items={report.openQuestions} tone="text-text-2" none={none} />
    </GlowCard>
  )
}
