import type { ProviderId, ProviderModel } from "@/domain"
import { parseModelRef, type Dosage } from "@/domain"

/** Weight per dosage level: routing score penalty, pool order and handover order follow it; 0 = never used unless pinned by hand. */
export const DOSAGE_WEIGHT: Record<Dosage, number> = { none: 0, minimal: 0.15, low: 0.4, medium: 0.7, high: 1 }
/** How many tasks per run a minimal provider may get (the planner is told so). */
export const MINIMAL_TASK_CAP = 2

export type DosageWeights = Partial<Record<ProviderId, number>>

export function dosageWeights(settings: { providerDosage?: Partial<Record<ProviderId, Dosage>> }): Record<ProviderId, number> {
  const out = {} as Record<ProviderId, number>
  for (const [id, level] of Object.entries(settings.providerDosage ?? {}) as Array<[ProviderId, Dosage]>) out[id] = DOSAGE_WEIGHT[level] ?? 1
  return new Proxy(out, { get: (t, k) => (k in t ? t[k as ProviderId] : typeof k === "string" ? 1 : undefined) }) as Record<ProviderId, number>
}

export function weightOf(ref: string, weights?: DosageWeights): number {
  if (!weights) return 1
  const w = weights[parseModelRef(ref).providerId as ProviderId]
  return w === undefined ? 1 : w
}

/** Pool ordered by weight (stable inside a level); none-level models are dropped. An all-none pool is returned as is (the user pinned it on purpose). */
export function orderByDosage(pool: string[], weights?: DosageWeights): string[] {
  if (!weights) return pool
  const kept = pool.filter((ref) => weightOf(ref, weights) > 0)
  if (!kept.length) return pool
  return kept.map((ref, i) => ({ ref, i, w: weightOf(ref, weights) })).sort((a, b) => b.w - a.w || a.i - b.i).map((x) => x.ref)
}

/** The planner / auto-blueprint sentence; empty when every provider is at high. */
export function dosageLine(settings: { providerDosage?: Partial<Record<ProviderId, Dosage>> }, models: ProviderModel[]): string {
  const present = new Set(models.map((m) => m.providerId))
  const parts = (Object.entries(settings.providerDosage ?? {}) as Array<[ProviderId, Dosage]>)
    .filter(([id, level]) => present.has(id) && level !== "high")
    .map(([id, level]) => `${id}: ${level}${level === "minimal" ? ` (at most ${MINIMAL_TASK_CAP} small tasks per run)` : level === "none" ? " (never)" : ""}`)
  if (!parts.length) return ""
  return `- MODEL DOSAGE (the user's quota plan — obey it when choosing \`model\`): ${parts.join("; ")}. Give the bulk of the work to the providers not listed here or listed as medium; never give minimal/low providers architecture, integration or browser tasks.`
}

/** Handover target for a single CLI session: the next pool model by weight that is still usable, else the settings fallback. */
export function pickHandoverTarget(i: { current: string; pool: string[]; unavailable: string[]; weights?: DosageWeights; fallbackRef?: string }): string | undefined {
  const dead = new Set([i.current, ...i.unavailable])
  const next = orderByDosage(i.pool, i.weights).find((ref) => !dead.has(ref))
  if (next) return next
  return i.fallbackRef && !dead.has(i.fallbackRef) ? i.fallbackRef : undefined
}
