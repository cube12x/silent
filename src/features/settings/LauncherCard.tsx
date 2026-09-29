import * as React from "react"
import { GlowCard, NeonButton, SectionHeader } from "@/design-system"
import { getBackend } from "@/services"
import type { LauncherStatus } from "@/services/backend"
import { shellPathHint } from "@/lib/platform"
import { useT } from "@/i18n"

export function LauncherCard() {
  const t = useT()
  const [status, setStatus] = React.useState<LauncherStatus | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    void getBackend().then((b) => b.cliLauncherStatus()).then(setStatus).catch(() => setStatus(null))
  }, [])
  const install = async () => {
    setBusy(true)
    setError(null)
    try {
      const b = await getBackend()
      setStatus(await b.installCliLauncher())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const dir = status?.dir ?? ""
  return (
    <GlowCard className="flex flex-col gap-2">
      <SectionHeader eyebrow={t("common.cli")} title={t("settings.launcherTitle")} description={t("settings.launcherHint")} actions={<NeonButton size="sm" variant={status?.installed ? "outline" : "default"} disabled={busy || !status} onClick={install}>{t("settings.launcherInstall")}</NeonButton>} />
      {status?.installed && <div className="mono text-[11px] text-text-2">{t("settings.launcherInstalled", { path: status.path })}</div>}
      {status && !status.onPath && <div className="mono text-[11px] text-warn">{t("settings.launcherNotOnPath", { hint: shellPathHint(dir) })}</div>}
      {error && <div className="text-[11px] text-danger">{error}</div>}
    </GlowCard>
  )
}

