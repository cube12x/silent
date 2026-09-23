import { useLocation, useNavigate, useParams } from "react-router"
import { cn } from "cn"
import { Bell, PanelRight, Settings2, Smartphone, Wallet, Cpu, ShieldCheck } from "lucide-react"
import { useUiStore } from "@/stores/ui"
import { useProvidersStore } from "@/stores/providers"
import { useRunsStore } from "@/stores/runs"
import { useSettingsStore } from "@/stores/settings"
import { usePhoneStore } from "@/stores/phone"
import { useChatsStore } from "@/stores/chats"
import { useAgentsStore } from "@/stores/agents"
import { COST_MODE_LABELS } from "@/domain"
import { ProviderLogo, TacticalChip } from "@/design-system"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Kbd } from "@/components/ui/kbd"

function useTitle(): { workspace: string; title: string } {
  const { pathname } = useLocation()
  const params = useParams()
  const chat = useChatsStore((s) => s.byId(params.chatId))
  const agent = useAgentsStore((s) => s.byId(params.agentId))
  const run = useRunsStore((s) => s.byId(params.runId))
  if (chat) return { workspace: chat.kind === "repo-agent" ? "Repo Agent Chat" : "Standard Chat", title: chat.title }
  if (agent) return { workspace: "Repo Agent", title: agent.name }
  if (run) return { workspace: "Silent Code Session", title: run.title }
  const map: Record<string, [string, string]> = {
    "/": ["Workspace", "Command Center"],
    "/silent-code": ["Silent Code", "New orchestration"],
    "/runs": ["Live Monitor", "All sessions"],
    "/agents": ["Repo Agents", "All agents"],
    "/memory": ["Memory", "Layered context"],
    "/settings": ["Settings", "Model management"],
    "/phone": ["Phone Link", "Mobile bridge"],
    "/dev/kit": ["Dev", "Design kit"],
  }
  const [workspace, title] = map[pathname] ?? ["Silent", ""]
  return { workspace, title }
}

export function TopBar() {
  const { workspace, title } = useTitle()
  const navigate = useNavigate()
  const providers = useProvidersStore((s) => s.providers)
  const active = useRunsStore((s) => s.activeCount())
  const running = useRunsStore((s) => s.runs.filter((r) => r.status === "running").length)
  const costMode = useSettingsStore((s) => s.settings.costMode)
  const phone = usePhoneStore((s) => s.status)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen)
  const codex = providers.find((p) => p.id === "codex")
  const systemOk = codex?.status === "connected"

  return (
    <header className="drag-region flex h-12 items-center gap-3 border-b border-line bg-ink-1/90 pl-[88px] pr-3 backdrop-blur-md">
      <div className="no-drag min-w-0">
        <div className="text-[9px] font-semibold tracking-[0.2em] text-text-3 uppercase">{workspace}</div>
        <div className="truncate font-heading text-[13px] font-semibold text-text-1">{title}</div>
      </div>

      <div className="no-drag ml-4 hidden items-center gap-1 lg:flex">
        {providers.map((p) => (
          <Tooltip key={p.id}>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => navigate("/settings")} className={cn("relative flex size-7 items-center justify-center rounded-md transition-opacity", p.status === "disabled" || p.status === "not-installed" ? "opacity-35" : "opacity-100 hover:bg-ink-3")}>
                <ProviderLogo provider={p.id} size={12} plain className="!size-5" />
                <span className={cn("absolute right-0.5 bottom-0.5 size-1.5 rounded-full", p.status === "connected" ? "bg-success" : p.status === "simulated" ? "bg-violet" : p.status === "error" ? "bg-danger" : "bg-text-3")} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {p.name} · {p.status}
              {p.version ? ` · ${p.version}` : ""}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="no-drag ml-auto flex items-center gap-2">
        <TacticalChip tone={active ? "cyan" : "neutral"} dot pulse={active > 0}>
          <Cpu className="size-3" />
          {active} active AI{active === 1 ? "" : "s"}
          {running > 0 && <span className="text-text-3">· {running} run{running > 1 ? "s" : ""}</span>}
        </TacticalChip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <TacticalChip tone={systemOk ? "success" : "warn"} dot pulse={false}>
                <ShieldCheck className="size-3" />
                {systemOk ? "system nominal" : "codex offline"}
              </TacticalChip>
            </span>
          </TooltipTrigger>
          <TooltipContent>{systemOk ? `Codex CLI ${codex?.version ?? ""} ready · sandbox capped at workspace-write` : "Codex CLI not detected. Install it to execute for real; other models run simulated."}</TooltipContent>
        </Tooltip>
        <button type="button" onClick={() => navigate("/settings")} className="group">
          <TacticalChip tone="violet" className="group-hover:border-violet/70">
            <Wallet className="size-3" />
            {COST_MODE_LABELS[costMode]}
          </TacticalChip>
        </button>
        <button type="button" onClick={() => navigate("/phone")} className="group">
          <TacticalChip tone={phone === "connected" ? "success" : phone === "pairing" ? "warn" : "neutral"} dot pulse={phone === "pairing"}>
            <Smartphone className="size-3" />
            {phone === "connected" ? "phone linked" : phone === "pairing" ? "pairing" : "no phone"}
          </TacticalChip>
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button type="button" className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-ink-3 hover:text-text-1" aria-label="Notifications"><Bell className="size-4" /></button>
        <button type="button" onClick={() => navigate("/settings")} className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-ink-3 hover:text-text-1" aria-label="Settings"><Settings2 className="size-4" /></button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={toggleRightPanel} className={cn("flex size-7 items-center justify-center rounded-md hover:bg-ink-3", rightPanelOpen ? "text-cyan" : "text-text-2")} aria-label="Toggle intelligence panel"><PanelRight className="size-4" /></button>
          </TooltipTrigger>
          <TooltipContent>Intelligence panel <Kbd className="ml-1">⌘.</Kbd></TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
