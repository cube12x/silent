import * as React from "react"
import { useNavigate } from "react-router"
import { Check, Compass, RefreshCw, X } from "lucide-react"
import { GlowCard, NeonButton, PageHeader, SectionHeader, TacticalChip } from "@/design-system"
import { useProvidersStore } from "@/stores/providers"
import { useSettingsStore } from "@/stores/settings"
import { getBackend } from "@/services"
import type { PrereqStatus } from "@/services/backend"
import { RECOMMENDED_PROVIDERS, setupReady } from "@/providers/setup"
import { CliCard } from "@/features/settings/CliCard"
import { LauncherCard } from "@/features/settings/LauncherCard"
import { PROVIDER_IDS } from "@/domain"
import { useT } from "@/i18n"

const HINT_KEY: Record<PrereqStatus["id"], string> = { node: "node", npm: "npm", git: "git", python3: "python3", "xcode-clt": "xcodeClt" }

/** First-run screen: prerequisites, the five recommended CLIs with one-click install/login, the terminal command. */
export function SetupScreen() {
  const t = useT()
  const navigate = useNavigate()
  const providers = useProvidersStore((s) => s.providers)
  const detect = useProvidersStore((s) => s.detect)
  const detecting = useProvidersStore((s) => s.detecting)
  const update = useSettingsStore((s) => s.update)
  const [prereqs, setPrereqs] = React.useState<PrereqStatus[] | null>(null)
  const [checking, setChecking] = React.useState(false)
  const check = React.useCallback(async () => {
    const backend = await getBackend()
    setChecking(true)
    try {
      setPrereqs(await backend.prereqsCheck())
    } catch {
      setPrereqs([])
    } finally {
      setChecking(false)
    }
  }, [])
  React.useEffect(() => {
    void check()
  }, [check])
  const installed = PROVIDER_IDS.filter((id) => providers[id].installed)
  const ready = setupReady(installed)
  const finish = () => {
    void update({ setupCompletedAt: Date.now() })
    navigate("/")
  }
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 p-6">
      <PageHeader eyebrow={t("setup.title")} title={t("setup.subtitle")} />

      <GlowCard className="flex flex-col gap-3">
        <SectionHeader eyebrow="1" title={t("setup.prereqs")} actions={<NeonButton size="sm" variant="outline" onClick={() => void check()} disabled={checking}><RefreshCw className={checking ? "animate-spin" : ""} />{t("setup.recheck")}</NeonButton>} />
        <ul className="flex flex-col divide-y divide-line">
          {(prereqs ?? []).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2 text-xs">
              <span className="mono w-24 text-text-1">{p.id}{p.id === "python3" ? <span className="ml-1 text-text-3">({t("setup.optional")})</span> : null}</span>
              <TacticalChip size="xs" tone={p.found ? "success" : p.id === "python3" ? "neutral" : "warn"} dot>{p.found ? t("setup.found") : t("setup.missing")}</TacticalChip>
              <span className="mono truncate text-[11px] text-text-3">{p.version ?? ""}{p.path ? ` · ${p.path}` : ""}{p.note ? ` · ${p.note}` : ""}</span>
              {!p.found && <span className="mono w-full text-[11px] text-text-2">{t(`setup.prereqHint.${HINT_KEY[p.id]}` as never)}</span>}
            </li>
          ))}
          {prereqs && prereqs.length === 0 && <li className="py-2 text-xs text-text-3">—</li>}
        </ul>
      </GlowCard>

      <GlowCard className="flex flex-col gap-3">
        <SectionHeader eyebrow="2" title={t("setup.clis")} description={t("setup.readyHint")} actions={<div className="flex gap-2"><NeonButton size="sm" variant="outline" onClick={() => void detect()} disabled={detecting}><RefreshCw className={detecting ? "animate-spin" : ""} />{t("setup.rescan")}</NeonButton><NeonButton size="sm" variant="outline" onClick={() => navigate("/settings")}>{t("setup.allClis")}</NeonButton></div>} />
        <div className="grid gap-3 md:grid-cols-2">
          {RECOMMENDED_PROVIDERS.map((id) => <CliCard key={id} id={id} why={t(`setup.why.${id}` as never)} />)}
        </div>
      </GlowCard>

      <div className="flex flex-col gap-3">
        <SectionHeader eyebrow="3" title={t("setup.terminal")} />
        <LauncherCard />
      </div>

      <div className="flex items-center gap-3">
        <NeonButton data-testid="setup-continue" onClick={finish} disabled={!ready}><Check />{t("setup.continue")}</NeonButton>
        <button type="button" data-testid="setup-skip" onClick={finish} className="flex items-center gap-1 text-xs text-text-3 hover:text-text-1"><X className="size-3" />{t("setup.skip")}</button>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-text-3"><Compass className="size-3" />{installed.length}/{PROVIDER_IDS.length}</span>
      </div>
    </div>
  )
}
