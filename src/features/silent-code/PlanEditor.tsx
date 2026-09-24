import * as React from "react"
import { cn } from "cn"
import { Plus, Trash2 } from "lucide-react"
import type { Effort, ProviderModel, RoutingDecision, Subtask, SubtaskKind } from "@/domain"
import { SUBTASK_KINDS, modelRef } from "@/domain"
import { effortFor, timeoutFor } from "@/engine/effort"
import { ModelLogo, TacticalChip } from "@/design-system"
import { PROVIDERS } from "@/providers/registry"
import { useT } from "@/i18n"
import { newId } from "@/lib/ids"

export interface PlanEdit {
  plan: Subtask[]
  routing: RoutingDecision[]
}

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh"]

/**
 * Editable plan: per subtask pick the model (from the pool), effort and time limit; remove or add tasks.
 * In auto mode the router's suggestion is shown and re-computed; in manual mode edits are final.
 */
export function PlanEditor({ plan, routing, models, pool, costMode, manual, onChange, kindLabels }: { plan: Subtask[]; routing: RoutingDecision[]; models: ProviderModel[]; pool: string[]; costMode: "economy" | "balanced" | "max-quality"; manual: boolean; onChange: (edit: PlanEdit) => void; kindLabels: Record<SubtaskKind, string> }) {
  const t = useT()
  const byRef = React.useMemo(() => new Map(models.map((m) => [modelRef(m.providerId, m.id), m])), [models])
  const poolModels = pool.map((r) => byRef.get(r)).filter((m): m is ProviderModel => Boolean(m))
  const decision = (id: string) => routing.find((r) => r.subtaskId === id)

  const setModel = (subtaskId: string, ref: string) =>
    onChange({ plan, routing: routing.map((r) => (r.subtaskId === subtaskId ? { ...r, primaryModelId: ref, reason: manual ? "manual" : r.reason, fallbackModelIds: r.fallbackModelIds.filter((f) => f !== ref) } : r)) })
  const patch = (subtaskId: string, p: Partial<Subtask>) => onChange({ plan: plan.map((s) => (s.id === subtaskId ? { ...s, ...p } : s)), routing })
  const remove = (subtaskId: string) =>
    onChange({ plan: plan.filter((s) => s.id !== subtaskId).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== subtaskId) })), routing: routing.filter((r) => r.subtaskId !== subtaskId) })
  const add = (kind: SubtaskKind) => {
    const id = newId("st")
    const last = plan.at(-1)
    const s: Subtask = { id, runId: plan[0]?.runId ?? "draft", kind, title: `${kindLabels[kind]}`, description: "", dependsOn: last ? [last.id] : [], state: "waiting", attempts: [], files: [], commands: [], weight: 2, progress: 0, lastUpdate: 0, answers: [], deviations: [] }
    const first = poolModels[0]
    onChange({ plan: [...plan, s], routing: [...routing, { subtaskId: id, kind, primaryModelId: first ? modelRef(first.providerId, first.id) : "", fallbackModelIds: [], reason: "manual", score: 0 }] })
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
        {plan.map((s) => {
          const d = decision(s.id)
          const model = d?.primaryModelId ? byRef.get(d.primaryModelId) : undefined
          const effort = s.effort ?? effortFor(s.kind, costMode, model?.tier)
          const timeout = s.timeoutSecs ?? timeoutFor(s.kind, s.weight)
          return (
            <li key={s.id} className="grid grid-cols-[110px_minmax(0,1fr)_auto_auto_auto] items-center gap-2 px-3 py-2">
              <TacticalChip size="xs" tone="neutral">{kindLabels[s.kind]}</TacticalChip>
              <div className="flex min-w-0 items-center gap-2">
                {d?.primaryModelId ? <ModelLogo modelRef={d.primaryModelId} size={10} plain className="!size-4" /> : null}
                <select value={d?.primaryModelId ?? ""} onChange={(e) => setModel(s.id, e.target.value)} className="h-7 min-w-0 flex-1 rounded-sm border border-line bg-ink-2 px-1.5 text-[11px] text-text-1 outline-none focus:border-text-2">
                  {!d?.primaryModelId && <option value="">—</option>}
                  {poolModels.map((m) => (
                    <option key={m.id + m.providerId} value={modelRef(m.providerId, m.id)}>{PROVIDERS[m.providerId].name} · {m.displayName} ({m.tier})</option>
                  ))}
                </select>
              </div>
              <select value={effort} onChange={(e) => patch(s.id, { effort: e.target.value as Effort })} title={t("code.effort")} className="h-7 rounded-sm border border-line bg-ink-2 px-1.5 text-[11px] text-text-1 outline-none focus:border-text-2">
                {EFFORTS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <input type="number" min={2} max={120} value={Math.round(timeout / 60)} onChange={(e) => patch(s.id, { timeoutSecs: Math.max(120, Number(e.target.value) * 60) })} title={t("code.timeoutMin")} className="mono h-7 w-16 rounded-sm border border-line bg-ink-2 px-1.5 text-[11px] text-text-1 outline-none focus:border-text-2" />
              <button type="button" onClick={() => remove(s.id)} className={cn("flex size-7 items-center justify-center rounded-sm text-text-3 hover:text-danger")} aria-label={t("code.removeTask")}><Trash2 className="size-3.5" /></button>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-[10px] tracking-wider text-text-3 uppercase"><Plus className="size-3" />{t("code.addTask")}</span>
        {SUBTASK_KINDS.map((k) => <button key={k} type="button" onClick={() => add(k)} className="rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-text-2 hover:border-text-2 hover:text-text-1">{kindLabels[k]}</button>)}
      </div>
      <div className="text-[10px] text-text-3">{t("code.continueOnTimeout")}</div>
    </div>
  )
}
