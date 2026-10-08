import * as React from "react"
import { appVersion, shortcut } from "@/lib/platform"
import { NavLink, useNavigate } from "react-router"
import { cn } from "cn"
import { Bot, BrainCircuit, ChevronsLeft, ChevronsRight, Cpu, GitBranch, MessageSquare, Plus, Search, Settings2, Zap, Languages, Workflow, Trash2 } from "lucide-react"
import { SilentMark } from "./SilentMark"
import { Kbd } from "@/components/ui/kbd"
import { useUiStore } from "@/stores/ui"
import { useChatsStore } from "@/stores/chats"
import { useAgentsStore } from "@/stores/agents"
import { useRunsStore } from "@/stores/runs"
import { useBlueprintsStore } from "@/stores/blueprints"
import { useMindStore } from "@/stores/mind"
import { useSettingsStore } from "@/stores/settings"
import { formatTokens } from "@/lib/format"
import { ModelLogo, RunStatusBadge } from "@/design-system"
import { formatRelative } from "@/lib/format"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useT } from "@/i18n"
import { modelRef } from "@/domain"

function Section({ title, count, children, collapsed, action }: { title: string; count?: number; children: React.ReactNode; collapsed: boolean; action?: React.ReactNode }) {
  if (collapsed) return <div className="border-t border-line/70 pt-2">{children}</div>
  return (
    <div className="pt-3">
      <div className="mb-1 flex items-center justify-between px-3 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">
        <span>{title}{count !== undefined && <span className="ml-1.5 text-text-3/70">{count}</span>}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

function Item({ to, icon, label, meta, collapsed, badge, end, tone }: { to: string; icon: React.ReactNode; label: string; meta?: React.ReactNode; collapsed: boolean; badge?: React.ReactNode; end?: boolean; /** Mind items light up orange instead of white. */ tone?: "mind" }) {
  const mind = tone === "mind"
  const link = (
    <NavLink to={to} end={end} className={({ isActive }) => cn("group relative mx-2 flex items-center gap-2.5 px-2 py-1.5 text-[13px] transition-all duration-150", mind ? "rounded-none" : "rounded-lg", isActive ? (mind ? "bg-mind/[0.1] text-text-1 shadow-[inset_0_0_0_1px_var(--mind)]" : "bg-cyan/[0.08] text-text-1 shadow-[inset_0_0_0_1px_var(--line-strong)]") : "text-text-2 hover:bg-ink-3/70 hover:text-text-1", collapsed && "justify-center px-0")}>
      {({ isActive }) => (
        <>
          <span className={cn("absolute top-1/2 -left-2 h-4 w-0.5 -translate-y-1/2 rounded-full transition-opacity", mind ? "bg-mind" : "bg-cyan", isActive ? "opacity-100" : "opacity-0")} />
          <span className={cn("flex size-6 shrink-0 items-center justify-center [&_svg]:size-4", isActive ? (mind ? "text-mind" : "text-cyan") : "text-text-3 group-hover:text-text-2")}>{icon}</span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {meta && <span className="mono shrink-0 text-[10px] text-text-3">{meta}</span>}
              {badge}
            </>
          )}
        </>
      )}
    </NavLink>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Two-click "delete every run" (the webview has no confirm()): arms for 4 s, then cancels and deletes all runs. */
function DeleteAllRunsButton() {
  const t = useT()
  const navigate = useNavigate()
  const removeAll = useRunsStore((s) => s.removeAll)
  const [armed, setArmed] = React.useState(false)
  React.useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <button
      type="button"
      title={armed ? t("code.confirmDeleteAll") : t("code.deleteAll")}
      aria-label={armed ? t("code.confirmDeleteAll") : t("code.deleteAll")}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }
        void removeAll().then(() => navigate("/code"))
      }}
      className={armed ? "text-danger" : "text-text-3 hover:text-danger"}
    >
      <Trash2 className="size-3" />
    </button>
  )
}

export function Sidebar() {
  const t = useT()
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggle = useUiStore((s) => s.toggleSidebar)
  const openNewSession = useUiStore((s) => s.openNewSession)
  const setPalette = useUiStore((s) => s.setPalette)
  const chats = useChatsStore((s) => s.chats)
  const agents = useAgentsStore((s) => s.agents)
  const runs = useRunsStore((s) => s.runs)
  const blueprints = useBlueprintsStore((s) => s.blueprints)
  const language = useSettingsStore((s) => s.settings.language)
  const mode = useSettingsStore((s) => s.settings.mode ?? "maker")
  const update = useSettingsStore((s) => s.update)
  const minds = useMindStore((s) => s.models)
  const mindBusy = useMindStore((s) => s.busy)
  const createMind = useMindStore((s) => s.create)
  const navigate = useNavigate()
  const makerChats = chats.filter((c) => c.kind !== "mind")
  const running = runs.filter((r) => r.status === "running").length
  const switchMode = (next: "maker" | "mind") => {
    void update({ mode: next })
    navigate(next === "mind" ? "/mind" : "/chat")
  }
  const runLabel = (s: (typeof runs)[number]["status"]) => t(`code.runStatus.${s}` as const)

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-12 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
        <SilentMark size={26} glow mood={running ? "busy" : "calm"} />
        {!collapsed && (
          <div className="leading-none">
            <div className="font-heading text-sm font-semibold tracking-[0.22em] uppercase">Silent</div>
            <div className="text-[9px] tracking-[0.2em] text-text-3 uppercase">{t("app.tagline")}</div>
          </div>
        )}
        <button type="button" onClick={toggle} className={cn("ml-auto flex size-6 items-center justify-center rounded-md text-text-3 hover:bg-ink-3 hover:text-text-1", collapsed && "hidden")} aria-label={t("nav.collapse")}><ChevronsLeft className="size-3.5" /></button>
      </div>

      <div className={cn("mx-3 mb-2 grid grid-cols-2 border border-line text-[10px] font-semibold tracking-[0.16em] uppercase", collapsed && "mx-1 grid-cols-1")} data-testid="mode-switch">
        <button type="button" onClick={() => switchMode("maker")} data-testid="mode-maker" className={cn("h-7", mode === "maker" ? "bg-text-1 text-black" : "text-text-3 hover:text-text-1")}>{collapsed ? "M" : t("mind.maker")}</button>
        <button type="button" onClick={() => switchMode("mind")} data-testid="mode-mind" className={cn("h-7", mode === "mind" ? "bg-mind text-black" : "text-mind/70 hover:text-mind")}>{collapsed ? "◆" : t("mind.mind")}</button>
      </div>

      <div className={cn("flex gap-2 px-3 pb-1", collapsed && "flex-col items-center px-0")}>
        {mode === "mind" ? (
          <button type="button" data-testid="mind-new-sidebar" onClick={() => void createMind().then((m) => navigate(`/mind/${m.id}`))} className={cn("flex h-8 flex-1 items-center justify-center gap-2 rounded-none border border-mind/60 bg-mind/10 text-[13px] font-medium text-mind transition-all hover:bg-mind/20", collapsed && "size-8 flex-none")}>
            <Plus className="size-4" />
            {!collapsed && <span>{t("mind.newModel")}</span>}
            {!collapsed && <Kbd className="ml-auto border-mind/30 bg-transparent text-mind/70">{shortcut("N")}</Kbd>}
          </button>
        ) : (
          <button type="button" onClick={() => openNewSession({ kind: "standard" })} className={cn("flex h-8 flex-1 items-center justify-center gap-2 rounded-lg border border-cyan/40 bg-cyan/10 text-[13px] font-medium text-cyan transition-all hover:bg-cyan/15 ", collapsed && "size-8 flex-none")}>
            <Plus className="size-4" />
            {!collapsed && <span>{t("nav.newChat")}</span>}
            {!collapsed && <Kbd className="ml-auto border-cyan/30 bg-transparent text-cyan/70">{shortcut("N")}</Kbd>}
          </button>
        )}
        <button type="button" onClick={() => setPalette(true)} className="flex size-8 items-center justify-center rounded-lg border border-line bg-ink-2 text-text-2 hover:border-line-strong hover:text-text-1" aria-label={t("nav.search")}><Search className="size-4" /></button>
        {collapsed && <button type="button" onClick={toggle} className="flex size-8 items-center justify-center rounded-lg text-text-3 hover:bg-ink-3 hover:text-text-1" aria-label={t("nav.expand")}><ChevronsRight className="size-4" /></button>}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto pb-3">
        {mode === "mind" ? (
          <Section title={t("mind.models")} count={minds.length} collapsed={collapsed} action={<button type="button" className="text-text-3 hover:text-mind" onClick={() => void createMind().then((m) => navigate(`/mind/${m.id}`))}><Plus className="size-3" /></button>}>
            {minds.map((m) => (
              <Item key={m.id} to={`/mind/${m.id}`} tone="mind" icon={<BrainCircuit className={cn(mindBusy[m.id] && "animate-pulse")} />} label={m.name} collapsed={collapsed} meta={m.tokens ? formatTokens(m.tokens) : m.status === "started" ? "●" : undefined} />
            ))}
            {minds.length === 0 && !collapsed && <div className="px-4 py-1 text-[11px] text-text-3">{t("common.none")}</div>}
          </Section>
        ) : (
          <>
        <Section title={t("nav.chats")} count={makerChats.length} collapsed={collapsed}>
          {makerChats.slice(0, collapsed ? 4 : 12).map((c) => (
            <Item key={c.id} to={`/chat/${c.id}`} icon={<ModelLogo modelRef={modelRef(c.providerId, c.modelId)} size={11} plain className="!size-5" />} label={c.title} collapsed={collapsed} meta={formatRelative(c.updatedAt)} />
          ))}
          {makerChats.length === 0 && !collapsed && <div className="px-4 py-1 text-[11px] text-text-3">{t("common.none")}</div>}
        </Section>

        <Section title={t("nav.silentCode")} count={runs.length} collapsed={collapsed} action={<span className="flex items-center gap-2">{runs.length > 0 && <DeleteAllRunsButton />}<NavLink to="/code" className="text-text-3 hover:text-cyan"><Plus className="size-3" /></NavLink></span>}>
          <Item to="/code" end icon={<Zap />} label={t("code.newRun")} collapsed={collapsed} meta={running || undefined} />
          {runs.slice(0, collapsed ? 3 : 8).map((r) => (
            <Item key={r.id} to={`/code/${r.id}`} icon={r.parentRunId ? <GitBranch /> : <Cpu />} label={`${r.parentRunId ? "↳ " : ""}${r.title}`} collapsed={collapsed} badge={!collapsed ? <RunStatusBadge status={r.status} size="xs" label={runLabel(r.status)} /> : undefined} />
          ))}
        </Section>

        <Section title={t("nav.blueprint")} count={blueprints.length} collapsed={collapsed} action={<NavLink to="/blueprint" className="text-text-3 hover:text-cyan"><Plus className="size-3" /></NavLink>}>
          {blueprints.slice(0, 6).map((b) => (
            <Item key={b.id} to={`/blueprint/${b.id}`} icon={<Workflow />} label={b.name} meta={`${b.nodes.length}`} collapsed={collapsed} />
          ))}
          {!blueprints.length && !collapsed && <NavLink to="/blueprint" className="mx-2 block rounded-lg px-2 py-1.5 text-[12px] text-text-3 hover:text-text-1">{t("bp.new")}</NavLink>}
        </Section>
        <Section title={t("nav.agents")} count={agents.length} collapsed={collapsed} action={<button type="button" className="text-text-3 hover:text-cyan" onClick={() => openNewSession({ kind: "repo-agent" })}><Plus className="size-3" /></button>}>
          <Item to="/agents" end icon={<Bot />} label={t("nav.allAgents")} collapsed={collapsed} />
          {agents.slice(0, collapsed ? 3 : 6).map((a) => (
            <Item key={a.id} to={`/agents/${a.id}`} icon={<ModelLogo modelRef={modelRef(a.providerId, a.modelId)} size={11} plain className="!size-5" />} label={a.name} collapsed={collapsed} />
          ))}
        </Section>
          </>
        )}
      </nav>

      <div className={cn("border-t border-line p-2", collapsed && "flex flex-col items-center")}>
        <Item to="/settings" icon={<Settings2 />} label={t("nav.settings")} collapsed={collapsed} />
        <button type="button" onClick={() => void update({ language: language === "tr" ? "en" : "tr" })} className={cn("mx-2 mt-1 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12px] text-text-3 hover:bg-ink-3/70 hover:text-text-1", collapsed && "mx-0 justify-center px-0")} aria-label={t("nav.language")}>
          <Languages className="size-4" />
          {!collapsed && <span>{language === "tr" ? "Türkçe → English" : "English → Türkçe"}</span>}
        </button>
        {!collapsed && <div className="mt-1 flex items-center gap-2 px-3 text-[10px] text-text-3"><MessageSquare className="size-3" />{`v${appVersion() || "dev"}`} · CLI-native</div>}
      </div>
    </div>
  )
}
