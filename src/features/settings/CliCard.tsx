import * as React from "react"
import { cn } from "cn"
import { Download, ExternalLink, LogIn } from "lucide-react"
import { useProvidersStore } from "@/stores/providers"
import { GlowCard, NeonButton, ProviderLogo, TacticalChip, TerminalView } from "@/design-system"
import type { ProviderId } from "@/domain"
import { PROVIDERS } from "@/providers/registry"
import { installOptions, looksLikeNpmPermissionError } from "@/providers/install"
import { platform } from "@/lib/platform"
import { Switch } from "@/components/ui/switch"
import { getBackend } from "@/services"
import { useT } from "@/i18n"

export function CliCard({ id, why }: { id: ProviderId; why?: string }) {
  const t = useT()
  const info = PROVIDERS[id]
  const p = useProvidersStore((s) => s.providers[id])
  const setEnabled = useProvidersStore((s) => s.setEnabled)
  const install = useProvidersStore((s) => s.install)
  const login = useProvidersStore((s) => s.login)
  const fixNpmPrefix = useProvidersStore((s) => s.fixNpmPrefix)
  const options = installOptions(info, platform())
  const npmDenied = !p.installed && platform() !== "windows" && looksLikeNpmPermissionError(p.installLog.map((l) => l.text).join("\n"))
  const [showLog, setShowLog] = React.useState(false)
  const scanned = useProvidersStore((s) => !!s.lastDetectedAt && !s.detecting)
  return (
    <GlowCard tone={p.installed ? (id === "codex" ? "cyan" : "default") : "default"} className={cn("flex flex-col gap-3", !p.installed && "opacity-90")}>
      <div className="flex items-start gap-3">
        <ProviderLogo provider={id} size={20} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-heading text-sm font-semibold">
            {info.name}
            <span className="text-[11px] font-normal text-text-3">{info.vendor}</span>
            <TacticalChip size="xs" tone={p.installed ? "success" : "neutral"} dot>{p.installed ? t("common.installed") : t("common.notInstalled")}</TacticalChip>
            <TacticalChip size="xs" tone={info.parserMaturity === "verified" ? "cyan" : "warn"} title={t("settings.parserHint")}>{info.parserMaturity === "verified" ? t("settings.parserVerified") : t("settings.parserBeta")}</TacticalChip>
          </div>
          <div className="mono truncate text-[10px] text-text-3">{p.installed ? `${p.detected?.version ?? ""} · ${p.detected?.path ?? ""}` : info.binary}</div>
          {why && <div className="mt-1 text-[11px] text-text-2">{why}</div>}
          {info.note && <div className="mt-1 text-[11px] text-text-3">{info.note}</div>}
        </div>
        {p.installed && <Switch checked={p.enabled} onCheckedChange={(v) => void setEnabled(id, v)} className={cn(p.enabled && "data-[state=checked]:bg-cyan")} aria-label={t("common.enabled")} />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!p.installed && scanned && options.map((o, i) => <NeonButton key={o.method} size="sm" variant={i === 0 ? "default" : "outline"} disabled={p.installing} title={o.command} onClick={() => { setShowLog(true); void install(id, o.method) }}><Download />{p.installing ? t("settings.installing") : o.method === "npm" ? t("settings.installVia", { method: "npm" }) : t("settings.install")}</NeonButton>)}
        {!p.installed && scanned && options.length === 0 && <span className="text-[11px] text-text-3">{t("settings.installManual")}</span>}
        {npmDenied && <NeonButton size="sm" variant="outline" disabled={p.installing} onClick={() => { setShowLog(true); void fixNpmPrefix(id) }}>{t("settings.npmFix")}</NeonButton>}
        {!p.installed && !scanned && <span className="text-[11px] text-text-3">{t("settings.detectPending")}</span>}
        {p.installed && <NeonButton size="sm" variant="outline" onClick={() => void login(id)} title={t("settings.loginHint", { cmd: info.loginCommand })}><LogIn />{t("settings.login")}</NeonButton>}
        <button type="button" onClick={() => void getBackend().then((b) => b.openExternal(info.docsUrl))} className="flex items-center gap-1 text-[11px] text-text-3 hover:text-cyan"><ExternalLink className="size-3" />docs</button>
        {p.installed && <span className="ml-auto text-[11px] text-text-3">{p.models.length} {t("common.models").toLowerCase()}</span>}
      </div>
      {(showLog || p.installLog.length > 0) && <TerminalView lines={p.installLog} live={p.installing} className="h-40" emptyText={t("settings.installLog")} />}
    </GlowCard>
  )
}

