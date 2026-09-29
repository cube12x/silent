import { useLocation, useNavigate, useParams } from "react-router"
import { cn } from "cn"
import { Cpu, Settings2 } from "lucide-react"
import { useProvidersStore } from "@/stores/providers"
import { useRunsStore } from "@/stores/runs"
import { useBlueprintsStore } from "@/stores/blueprints"
import { useChatsStore } from "@/stores/chats"
import { useAgentsStore } from "@/stores/agents"
import { PROVIDER_IDS } from "@/domain"
import { PROVIDERS } from "@/providers/registry"
import { ProviderLogo, TacticalChip } from "@/design-system"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useT } from "@/i18n"
import { isMac } from "@/lib/platform"

function useTitle(): { workspace: string; title: string } {
  const t = useT()
  const { pathname } = useLocation()
  const params = useParams()
  const chat = useChatsStore((s) => s.byId(params.chatId))
  const agent = useAgentsStore((s) => s.byId(params.agentId))
  const run = useRunsStore((s) => s.byId(params.runId))
  if (chat) return { workspace: t("chat.title"), title: chat.title }
  if (agent) return { workspace: t("agents.title"), title: agent.name }
  if (run) return { workspace: t("code.title"), title: run.title }
  if (pathname.startsWith("/code")) return { workspace: t("code.title"), title: t("code.newRun") }
  if (pathname.startsWith("/agents")) return { workspace: t("agents.title"), title: t("nav.allAgents") }
  if (pathname.startsWith("/settings")) return { workspace: t("settings.title"), title: t("settings.subtitle") }
  return { workspace: t("chat.title"), title: t("nav.newChat") }
}

export function TopBar() {
  const t = useT()
  const { workspace, title } = useTitle()
  const navigate = useNavigate()
  const providers = useProvidersStore((s) => s.providers)
  const active = useRunsStore((s) => s.activeCount())
  // Blueprint single sessions / wizards are not runs; orchestration AIs are already counted through the runs store.
  const bpActive = useBlueprintsStore((s) => s.blueprints.reduce((n, b) => n + b.nodes.filter((x) => x.status === "running" && !(x.data.type === "ai" && x.data.mode === "orchestration" && x.executionId)).length, 0))
  const installed = PROVIDER_IDS.filter((id) => providers[id].installed)

  return (
    <header data-tauri-drag-region className={cn("drag-region flex h-12 items-center gap-3 border-b border-line bg-ink-1/90 pr-3 backdrop-blur-md", isMac() ? "pl-[88px]" : "pl-3")}>
      <div className="no-drag min-w-0">
        <div className="text-[9px] font-semibold tracking-[0.2em] text-text-3 uppercase">{workspace}</div>
        <div className="truncate font-heading text-[13px] font-semibold text-text-1">{title}</div>
      </div>
      <div className="no-drag ml-4 flex items-center gap-0.5">
        {PROVIDER_IDS.map((id) => {
          const p = providers[id]
          if (!p.installed) return null
          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button type="button" onClick={() => navigate("/settings")} className={cn("relative flex size-7 items-center justify-center rounded-md hover:bg-ink-3", !p.enabled && "opacity-35")}>
                  <ProviderLogo provider={id} size={12} plain className="!size-5" />
                  <span className={cn("absolute right-0.5 bottom-0.5 size-1.5 rounded-full", p.enabled ? "bg-success" : "bg-text-3")} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{PROVIDERS[id].name} · {p.detected?.version ?? ""} · {p.models.length} {t("common.models").toLowerCase()}</TooltipContent>
            </Tooltip>
          )
        })}
        {installed.length === 0 && <button type="button" onClick={() => navigate("/setup")}><TacticalChip tone="warn" dot>{t("top.noCli")}</TacticalChip></button>}
      </div>
      <div className="no-drag ml-auto flex items-center gap-2">
        <TacticalChip tone={active + bpActive ? "cyan" : "neutral"} dot pulse={active + bpActive > 0}><Cpu className="size-3" />{active + bpActive} {t("top.activeAis")}</TacticalChip>
        <button type="button" onClick={() => navigate("/settings")} className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-ink-3 hover:text-text-1" aria-label={t("nav.settings")}><Settings2 className="size-4" /></button>
      </div>
    </header>
  )
}
