import * as React from "react"
import { cn } from "cn"
import { Cpu, Database, FolderOpen, KeyRound, Languages, RefreshCw, Route, ScrollText, Shield, ShieldCheck, Trash2, Plus, Check, Compass } from "lucide-react"
import { useSettingsStore } from "@/stores/settings"
import { useProvidersStore, selectAvailableModels } from "@/stores/providers"
import { useRunsStore } from "@/stores/runs"
import { GlowCard, KeyValueList, ModelTag, NeonButton, PageHeader, PermissionToggle, ProviderLogo, SectionHeader, TacticalChip } from "@/design-system"
import { COST_MODES, DOSAGE_LEVELS, PROVIDER_IDS, modelRef, type Dosage, type PermissionKey, type ProviderId, type SubtaskKind } from "@/domain"
import { PROVIDERS } from "@/providers/registry"
import { TARGET_TIER } from "@/engine/router"
import { effortFor, timeoutFor } from "@/engine/effort"
import type { ModelTier, Effort } from "@/domain"
import { Input } from "@/components/ui/input"
import { getBackend } from "@/services"
import { formatRelative } from "@/lib/format"
import { useT } from "@/i18n"
import { CliCard } from "./CliCard"
import { LauncherCard } from "./LauncherCard"
import { useNavigate } from "react-router"

const SECTION_IDS = ["clis", "workspace", "models", "language", "routing", "security", "permissions", "logs"] as const
type SectionId = (typeof SECTION_IDS)[number]
const ICONS: Record<SectionId, React.ReactNode> = { clis: <Cpu />, workspace: <FolderOpen />, models: <Database />, language: <Languages />, routing: <Route />, security: <Shield />, permissions: <ShieldCheck />, logs: <ScrollText /> }
const KINDS: SubtaskKind[] = ["architecture", "backend", "frontend", "algorithm", "tests", "review", "integration", "docs"]
const PERMS: PermissionKey[] = ["read", "write", "runTests", "terminal", "gitCommit", "gitPush", "network", "fileCreateDelete"]

function Select<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={cn("h-8 rounded-md border border-line bg-ink-2 px-2 text-xs text-text-1 outline-none focus:border-cyan/50", className)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function SettingsScreen() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const providers = useProvidersStore((s) => s.providers)
  const detecting = useProvidersStore((s) => s.detecting)
  const lastDetectedAt = useProvidersStore((s) => s.lastDetectedAt)
  const lastError = useProvidersStore((s) => s.lastError)
  const detect = useProvidersStore((s) => s.detect)
  const addCustomModel = useProvidersStore((s) => s.addCustomModel)
  const removeCustomModel = useProvidersStore((s) => s.removeCustomModel)
  const runs = useRunsStore((s) => s.runs)
  const [section, setSection] = React.useState<SectionId>("clis")
  const navigate = useNavigate()
  const [custom, setCustom] = React.useState<{ providerId: ProviderId; id: string; label: string }>({ providerId: "codex", id: "", label: "" })
  const available = React.useMemo(() => selectAvailableModels(providers), [providers])
  const modelOptions = available.map((m) => ({ value: modelRef(m.providerId, m.id), label: `${PROVIDERS[m.providerId].name} · ${m.displayName}` }))
  const installedIds = PROVIDER_IDS.filter((id) => providers[id].installed)
  const missingIds = PROVIDER_IDS.filter((id) => !providers[id].installed)

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-6 p-6">
      <PageHeader eyebrow={t("settings.title")} title={t("settings.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="flex flex-col gap-0.5 lg:sticky lg:top-6 lg:self-start">
          {SECTION_IDS.map((s) => (
            <button key={s} type="button" onClick={() => setSection(s)} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors [&_svg]:size-4", section === s ? "bg-cyan/[0.08] text-text-1 shadow-[inset_0_0_0_1px_var(--line-strong)] [&_svg]:text-cyan" : "text-text-2 hover:bg-ink-3/60 [&_svg]:text-text-3")}>
              {ICONS[s]}{t(`settings.sections.${s}` as const)}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-6">
          {section === "clis" && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-text-2">{t("settings.clisHint")}</p>
                <NeonButton size="sm" variant="outline" className="ml-auto" onClick={() => void detect()} disabled={detecting}><RefreshCw className={cn(detecting && "animate-spin")} />{detecting ? t("settings.detecting") : t("settings.redetect")}</NeonButton>
                {lastDetectedAt && <span className="text-[11px] text-text-3">{formatRelative(lastDetectedAt)}</span>}
                <NeonButton size="sm" variant="outline" onClick={() => navigate("/setup")}><Compass />{t("settings.setupGuide")}</NeonButton>
              </div>
              {lastError && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{t("settings.detectError", { error: lastError })}</div>}
              {installedIds.length === 0 && !lastError && <div className="text-[11px] text-text-3">{t("settings.alreadyInstalledHint")}</div>}
              <div className="grid gap-3 md:grid-cols-2">{installedIds.map((id) => <CliCard key={id} id={id} />)}</div>
              <LauncherCard />
              {missingIds.length > 0 && (
                <>
                  <SectionHeader eyebrow={t("common.notInstalled")} title={`${missingIds.length}`} />
                  <div className="grid gap-3 md:grid-cols-2">{missingIds.map((id) => <CliCard key={id} id={id} />)}</div>
                </>
              )}
            </>
          )}

          {section === "workspace" && (
            <GlowCard className="flex flex-col gap-3">
              <SectionHeader eyebrow={t("common.folder")} title={settings.workspaceDir?.trim() || t("settings.workspaceDefault")} description={t("settings.workspaceHint")} />
              <div className="flex flex-wrap gap-2">
                <NeonButton size="sm" onClick={() => void getBackend().then((b) => b.pickDirectory()).then((p) => { if (p) void update({ workspaceDir: p }) })}><FolderOpen />{t("settings.workspaceChoose")}</NeonButton>
                {settings.workspaceDir && <NeonButton size="sm" variant="outline" onClick={() => void update({ workspaceDir: "" })}>{t("settings.workspaceReset")}</NeonButton>}
              </div>
            </GlowCard>
          )}

          {section === "models" && (
            <>
              <p className="text-sm text-text-2">{t("settings.modelsHint")}</p>
              {installedIds.length === 0 && <GlowCard className="text-xs text-text-3">{t("modal.noModels")}</GlowCard>}
              {installedIds.map((id) => (
                <GlowCard key={id} className="flex flex-col gap-3">
                  <div className="flex items-center gap-3"><ProviderLogo provider={id} size={14} /><div className="font-heading text-sm font-semibold">{PROVIDERS[id].name}</div><span className="text-[11px] text-text-3">{providers[id].models.length}</span></div>
                  <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                    {providers[id].models.map((m) => {
                      const ref = modelRef(id, m.id)
                      const isDefault = settings.defaultModelRef === ref
                      return (
                        <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm">{m.displayName}</span><span className="mono block truncate text-[10px] text-text-3">{m.id}{m.meta?.efforts ? ` · effort: ${m.meta.efforts}` : ""}</span></span>
                          <TacticalChip size="xs" tone={m.tier === "frontier" ? "violet" : m.tier === "fast" ? "success" : "neutral"}>{m.tier}</TacticalChip>
                          <TacticalChip size="xs">{t(`settings.source.${m.source}` as const)}</TacticalChip>
                          {isDefault ? <TacticalChip size="xs" tone="cyan"><Check className="size-3" />{t("settings.isDefault")}</TacticalChip> : <button type="button" onClick={() => void update({ defaultModelRef: ref })} className="text-[11px] text-text-3 hover:text-cyan">{t("settings.setDefault")}</button>}
                          {m.source === "custom" && <button type="button" onClick={() => void removeCustomModel(id, m.id)} className="text-text-3 hover:text-danger" aria-label={t("common.remove")}><Trash2 className="size-3.5" /></button>}
                        </li>
                      )
                    })}
                  </ul>
                </GlowCard>
              ))}
              {installedIds.length > 0 && (
                <GlowCard className="flex flex-col gap-3">
                  <SectionHeader eyebrow={t("settings.addModel")} title="" />
                  <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void addCustomModel(custom.providerId, custom.id, custom.label); setCustom((c) => ({ ...c, id: "", label: "" })) }}>
                    <Select value={custom.providerId} options={installedIds.map((id) => ({ value: id, label: PROVIDERS[id].name }))} onChange={(v) => setCustom((c) => ({ ...c, providerId: v }))} />
                    <Input value={custom.id} onChange={(e) => setCustom((c) => ({ ...c, id: e.target.value }))} placeholder={t("settings.modelIdPh")} className="mono h-8 min-w-[240px] flex-1 border-line bg-ink-2 text-xs" />
                    <Input value={custom.label} onChange={(e) => setCustom((c) => ({ ...c, label: e.target.value }))} placeholder={t("settings.modelLabelPh")} className="h-8 min-w-[160px] border-line bg-ink-2 text-xs" />
                    <NeonButton size="sm" type="submit" disabled={!custom.id.trim()}><Plus />{t("common.add")}</NeonButton>
                  </form>
                </GlowCard>
              )}
            </>
          )}

          {section === "language" && (
            <GlowCard className="flex flex-col gap-3">
              <SectionHeader eyebrow={t("settings.sections.language")} title={t("settings.languageHint")} />
              <div className="grid gap-2 md:grid-cols-2">
                {(["tr", "en"] as const).map((l) => (
                  <button key={l} type="button" onClick={() => void update({ language: l })} className={cn("flex items-center justify-between rounded-lg border p-3 text-left", settings.language === l ? "border-cyan/50 bg-cyan/[0.06]" : "border-line hover:border-line-strong")}>
                    <span className="text-sm font-medium">{l === "tr" ? "Türkçe" : "English"}</span>
                    <span className={cn("size-2 rounded-full", settings.language === l ? "bg-cyan" : "bg-line-strong")} />
                  </button>
                ))}
              </div>
              <PermissionToggle label={t("settings.reducedMotion")} checked={settings.reducedMotion} onCheckedChange={(v) => void update({ reducedMotion: v })} />
            </GlowCard>
          )}

          {section === "routing" && (
            <GlowCard className="flex flex-col gap-4">
              <SectionHeader eyebrow={t("settings.sections.routing")} title={t("settings.routingHint")} />
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5"><span className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("settings.defaultModel")}</span><Select value={settings.defaultModelRef} options={modelOptions} onChange={(v) => void update({ defaultModelRef: v })} />{settings.defaultModelRef && <ModelTag modelRef={settings.defaultModelRef} size="xs" />}</label>
                <label className="flex flex-col gap-1.5"><span className="text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("settings.fallbackModel")}</span><Select value={settings.fallbackModelRef} options={modelOptions} onChange={(v) => void update({ fallbackModelRef: v })} />{settings.fallbackModelRef && <ModelTag modelRef={settings.fallbackModelRef} size="xs" />}</label>
              </div>
              <div>
                <div className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("code.cost")}</div>
                <div className="flex flex-wrap gap-2">{COST_MODES.map((c) => <button key={c} type="button" onClick={() => void update({ costMode: c })} className={cn("rounded-lg border px-3 py-1.5 text-sm", settings.costMode === c ? "border-violet/50 bg-violet/[0.08]" : "border-line")}>{t(`code.costModes.${c}` as const)}</button>)}</div>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">
                  {t("settings.policy")}
                  <div className="ml-auto flex rounded-sm border border-line text-[11px] normal-case tracking-normal">
                    <button type="button" onClick={() => void update((s) => ({ ...s, routingPolicy: { ...s.routingPolicy, mode: "auto" } }))} className={cn("px-2 py-0.5", settings.routingPolicy.mode === "auto" ? "bg-text-1 text-black" : "text-text-2")}>{t("settings.policyAuto")}</button>
                    <button type="button" onClick={() => void update((s) => ({ ...s, routingPolicy: { ...s.routingPolicy, mode: "manual" } }))} className={cn("px-2 py-0.5", settings.routingPolicy.mode === "manual" ? "bg-text-1 text-black" : "text-text-2")}>{t("settings.policyManual")}</button>
                  </div>
                </div>
                {settings.routingPolicy.mode === "manual" && <div className="mb-2 text-[11px] text-text-3">{t("settings.policyManualHint")}</div>}
                <table className="w-full text-[11px]">
                  <thead><tr className="text-left text-text-3"><th className="py-1 font-medium">{t("settings.kind")}</th><th className="py-1 font-medium">tier</th><th className="py-1 font-medium">{t("settings.pinnedModel")}</th><th className="py-1 font-medium">{t("code.effort")}</th><th className="py-1 font-medium">{t("code.timeoutMin")}</th></tr></thead>
                  <tbody>
                    {KINDS.map((k) => {
                      const manual = settings.routingPolicy.mode === "manual"
                      const row: { tier?: ModelTier; modelRef?: string; effort?: Effort; timeoutMin?: number } = settings.routingPolicy.table[k] ?? {}
                      const tier = row.tier ?? TARGET_TIER[settings.costMode][k]
                      const setRow = (patch: Partial<{ tier: ModelTier; modelRef?: string; effort?: Effort; timeoutMin?: number }>) => void update((s) => ({ ...s, routingPolicy: { ...s.routingPolicy, table: { ...s.routingPolicy.table, [k]: { tier, ...s.routingPolicy.table[k], ...patch } } } }))
                      return (
                        <tr key={k} className="border-t border-line">
                          <td className="py-1 text-text-1">{t(`code.kinds.${k}` as const)}</td>
                          <td className="py-1 text-text-2">{manual ? <Select value={tier} options={[{ value: "fast", label: "fast" }, { value: "strong", label: "strong" }, { value: "frontier", label: "frontier" }]} onChange={(v) => setRow({ tier: v })} className="h-7" /> : tier}</td>
                          <td className="py-1 text-text-2">{manual ? <Select value={row.modelRef ?? ""} options={[{ value: "", label: t("settings.auto") }, ...modelOptions]} onChange={(v) => setRow({ modelRef: v || undefined })} className="h-7 max-w-[220px]" /> : "—"}</td>
                          <td className="py-1 text-text-2">{manual ? <Select value={row.effort ?? effortFor(k, settings.costMode)} options={(["low", "medium", "high", "xhigh"] as Effort[]).map((e) => ({ value: e, label: e }))} onChange={(v) => setRow({ effort: v })} className="h-7" /> : effortFor(k, settings.costMode)}</td>
                          <td className="mono py-1 text-text-2">{manual ? <input type="number" min={2} max={120} value={row.timeoutMin ?? Math.round(timeoutFor(k, 2) / 60)} onChange={(e) => setRow({ timeoutMin: Number(e.target.value) })} className="mono h-7 w-16 rounded-sm border border-line bg-ink-2 px-1.5 text-[11px]" /> : Math.round(timeoutFor(k, 2) / 60)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("settings.overrides")}</div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {KINDS.map((k) => (
                    <label key={k} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-ink-2/50 px-3 py-2 text-sm">{t(`code.kinds.${k}` as const)}<Select value={settings.routingOverrides[k] ?? ""} options={[{ value: "", label: t("settings.auto") }, ...modelOptions]} onChange={(v) => void update((s) => ({ ...s, routingOverrides: { ...s.routingOverrides, [k]: v || undefined } }))} className="w-40" /></label>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-semibold tracking-[0.16em] text-text-3 uppercase">{t("settings.dosage")}</div>
                <div className="mb-2 text-[11px] text-text-3">{t("settings.dosageHint")}</div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {installedIds.map((id) => (
                    <label key={id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-ink-2/50 px-3 py-2 text-sm"><span className="flex items-center gap-2"><ProviderLogo provider={id} size={12} plain className="!size-4" />{PROVIDERS[id].name}</span><Select value={settings.providerDosage?.[id] ?? "high"} options={DOSAGE_LEVELS.map((l) => ({ value: l, label: t(`settings.dosageLevels.${l}` as const) }))} onChange={(v) => void update((s) => ({ ...s, providerDosage: { ...(s.providerDosage ?? {}), [id]: v as Dosage } }))} className="w-32" /></label>
                  ))}
                </div>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ink-2/50 px-3 py-2 text-sm">
                <span className="flex flex-col"><span>{t("settings.warmSessions")}</span><span className="text-[11px] text-text-3">{t("settings.warmSessionsHint")}</span></span>
                <input type="checkbox" checked={settings.warmSessions !== false} onChange={(e) => void update((s) => ({ ...s, warmSessions: e.target.checked }))} />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ink-2/50 px-3 py-2 text-sm">
                <span className="flex flex-col"><span>{t("settings.autoAnswer")}</span><span className="text-[11px] text-text-3">{t("settings.autoAnswerHint")}</span></span>
                <input type="number" min={0} max={240} value={settings.autoAnswerAfterMin ?? 10} onChange={(e) => void update((s) => ({ ...s, autoAnswerAfterMin: Math.max(0, Math.min(240, Number(e.target.value) || 0)) }))} className="mono h-7 w-20 rounded-sm border border-line bg-ink-2 px-1.5 text-[11px] text-text-1" />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ink-2/50 px-3 py-2 text-sm">
                <span className="flex flex-col"><span>{t("settings.browserFallback")}</span><span className="text-[11px] text-text-3">{t("settings.browserFallbackHint")}</span></span>
                <input type="checkbox" checked={settings.browserFallbackOutsidePool === true} onChange={(e) => void update((s) => ({ ...s, browserFallbackOutsidePool: e.target.checked }))} />
              </label>
            </GlowCard>
          )}

          {section === "security" && (
            <GlowCard className="flex flex-col gap-3">
              <SectionHeader eyebrow={t("settings.sections.security")} title={t("settings.securityHint")} />
              <PermissionToggle label={t("settings.dangerFull")} description={t("settings.dangerFullHint")} checked={false} locked danger />
              <PermissionToggle label={t("settings.redact")} description={t("settings.redactHint")} checked={settings.security.redactSecrets} onCheckedChange={(v) => void update((s) => ({ ...s, security: { ...s.security, redactSecrets: v } }))} />
              <PermissionToggle label={t("settings.pushApproval")} description={t("settings.pushApprovalHint")} checked={settings.security.requireApprovalForGitPush} onCheckedChange={(v) => void update((s) => ({ ...s, security: { ...s.security, requireApprovalForGitPush: v } }))} />
              <div className="flex items-center gap-2 rounded-lg border border-line bg-ink-2/50 px-3 py-2 text-xs text-text-2"><KeyRound className="size-3.5 text-text-3" />{t("settings.credentials")}</div>
            </GlowCard>
          )}

          {section === "permissions" && (
            <GlowCard className="flex flex-col gap-3">
              <SectionHeader eyebrow={t("settings.sections.permissions")} title={t("settings.permsHint")} />
              <div className="grid gap-2 md:grid-cols-2">{PERMS.map((k) => <PermissionToggle key={k} label={t(`agents.permLabels.${k}` as const)} checked={settings.defaultPermissions[k]} danger={k === "gitPush" || k === "network"} onCheckedChange={(v) => void update((s) => ({ ...s, defaultPermissions: { ...s.defaultPermissions, [k]: v } }))} />)}</div>
            </GlowCard>
          )}

          {section === "logs" && (
            <GlowCard className="flex flex-col gap-3">
              <SectionHeader eyebrow={t("settings.sections.logs")} title="" />
              <label className="flex items-center justify-between rounded-lg border border-line bg-ink-2/50 px-3 py-2 text-sm">{t("settings.logLevel")}<Select value={settings.logs.level} options={[{ value: "error", label: "error" }, { value: "warn", label: "warn" }, { value: "info", label: "info" }, { value: "debug", label: "debug" }]} onChange={(v) => void update((s) => ({ ...s, logs: { ...s.logs, level: v } }))} /></label>
              <label className="flex items-center justify-between rounded-lg border border-line bg-ink-2/50 px-3 py-2 text-sm">{t("settings.keepLines")}<input type="number" value={settings.logs.keepTerminalLines} onChange={(e) => void update((s) => ({ ...s, logs: { ...s.logs, keepTerminalLines: Number(e.target.value) } }))} className="mono h-7 w-24 rounded-md border border-line bg-ink-2 px-2 text-xs" /></label>
              <KeyValueList items={[{ label: t("settings.runsStored"), value: runs.length }, { label: t("settings.database"), value: "sqlite:silent.db", mono: true }, { label: t("settings.settingsFile"), value: "settings.json", mono: true }]} />
              <div className="text-xs text-text-3">{t("settings.logsNote")}</div>
            </GlowCard>
          )}
        </div>
      </div>
    </div>
  )
}
