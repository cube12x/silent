import * as React from "react"
import { NavLink, useNavigate } from "react-router"
import { cn } from "cn"
import { Bot, Brain, ChevronsLeft, ChevronsRight, Cpu, LayoutDashboard, MessageSquare, Plus, Search, Settings2, Smartphone, Activity, Zap } from "lucide-react"
import { SilentMark } from "./SilentMark"
import { Kbd } from "@/components/ui/kbd"
import { useUiStore } from "@/stores/ui"
import { useChatsStore } from "@/stores/chats"
import { useAgentsStore } from "@/stores/agents"
import { useRunsStore } from "@/stores/runs"
import { useActivityStore } from "@/stores/activity"
import { ModelLogo } from "@/design-system"
import { RunStatusBadge } from "@/design-system"
import { formatRelative } from "@/lib/format"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

function Section({ title, count, children, collapsed, action }: { title: string; count?: number; children: React.ReactNode; collapsed: boolean; action?: React.ReactNode }) {
  if (collapsed) return <div className="border-t border-line/70 pt-2">{children}</div>
  return (
    <div className="pt-3">
      <div className="mb-1 flex items-center justify-between px-3 text-[10px] font-semibold tracking-[0.18em] text-text-3 uppercase">
        <span>
          {title}
          {count !== undefined && <span className="ml-1.5 text-text-3/70">{count}</span>}
        </span>
        {action}
      </div>
      {children}
    </div>
  )
}

function Item({ to, icon, label, meta, collapsed, badge, end }: { to: string; icon: React.ReactNode; label: string; meta?: React.ReactNode; collapsed: boolean; badge?: React.ReactNode; end?: boolean }) {
  const link = (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group relative mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-all duration-150",
          isActive ? "bg-cyan/[0.08] text-text-1 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--cyan)_30%,transparent)]" : "text-text-2 hover:bg-ink-3/70 hover:text-text-1",
          collapsed && "justify-center px-0",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className={cn("absolute top-1/2 -left-2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-cyan transition-opacity", isActive ? "opacity-100" : "opacity-0")} />
          <span className={cn("flex size-6 shrink-0 items-center justify-center [&_svg]:size-4", isActive ? "text-cyan" : "text-text-3 group-hover:text-text-2")}>{icon}</span>
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

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggle = useUiStore((s) => s.toggleSidebar)
  const openNewSession = useUiStore((s) => s.openNewSession)
  const setPalette = useUiStore((s) => s.setPalette)
  const chats = useChatsStore((s) => s.chats)
  const agents = useAgentsStore((s) => s.agents)
  const runs = useRunsStore((s) => s.runs)
  const activity = useActivityStore((s) => s.items)
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-12 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
        <SilentMark size={22} glow />
        {!collapsed && (
          <div className="leading-none">
            <div className="font-heading text-sm font-semibold tracking-[0.22em] uppercase">Silent</div>
            <div className="text-[9px] tracking-[0.2em] text-text-3 uppercase">orchestration</div>
          </div>
        )}
        <button type="button" onClick={toggle} className={cn("ml-auto flex size-6 items-center justify-center rounded-md text-text-3 hover:bg-ink-3 hover:text-text-1", collapsed && "ml-0 hidden")} aria-label="Collapse sidebar">
          <ChevronsLeft className="size-3.5" />
        </button>
      </div>

      <div className={cn("flex gap-2 px-3 pb-1", collapsed && "flex-col items-center px-0")}>
        <button
          type="button"
          onClick={() => openNewSession({ kind: "standard" })}
          className={cn("flex h-8 flex-1 items-center justify-center gap-2 rounded-lg border border-cyan/40 bg-cyan/10 text-[13px] font-medium text-cyan transition-all hover:bg-cyan/15 hover:shadow-glow", collapsed && "size-8 flex-none")}
        >
          <Plus className="size-4" />
          {!collapsed && <span>New</span>}
          {!collapsed && <Kbd className="ml-auto border-cyan/30 bg-transparent text-cyan/70">⌘N</Kbd>}
        </button>
        <button type="button" onClick={() => setPalette(true)} className={cn("flex size-8 items-center justify-center rounded-lg border border-line bg-ink-2 text-text-2 hover:border-line-strong hover:text-text-1")} aria-label="Search">
          <Search className="size-4" />
        </button>
        {collapsed && (
          <button type="button" onClick={toggle} className="flex size-8 items-center justify-center rounded-lg text-text-3 hover:bg-ink-3 hover:text-text-1" aria-label="Expand sidebar">
            <ChevronsRight className="size-4" />
          </button>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto pb-3">
        <Section title="Command" collapsed={collapsed}>
          <Item to="/" end icon={<LayoutDashboard />} label="Dashboard" collapsed={collapsed} />
          <Item to="/silent-code" icon={<Zap />} label="Silent Code" collapsed={collapsed} badge={!collapsed ? <span className="rounded border border-violet/40 bg-violet/10 px-1 text-[9px] font-semibold tracking-wider text-violet uppercase">flagship</span> : undefined} />
          <Item to="/runs" icon={<Activity />} label="Live Monitor" collapsed={collapsed} meta={runs.filter((r) => r.status === "running").length || undefined} />
        </Section>

        <Section title="Standard Chats" count={chats.filter((c) => c.kind === "standard").length} collapsed={collapsed} action={<button type="button" className="text-text-3 hover:text-cyan" onClick={() => openNewSession({ kind: "standard" })}><Plus className="size-3" /></button>}>
          {chats
            .filter((c) => c.kind === "standard")
            .slice(0, collapsed ? 3 : 8)
            .map((c) => (
              <Item key={c.id} to={`/chat/${c.id}`} icon={<ModelLogo modelId={c.modelId} size={11} plain className="!size-5" />} label={c.title} collapsed={collapsed} meta={formatRelative(c.updatedAt)} />
            ))}
          {chats.filter((c) => c.kind === "standard").length === 0 && !collapsed && <div className="px-4 py-1 text-[11px] text-text-3">No chats yet.</div>}
        </Section>

        <Section title="Repo Agents" count={agents.length} collapsed={collapsed} action={<button type="button" className="text-text-3 hover:text-cyan" onClick={() => openNewSession({ kind: "repo-agent" })}><Plus className="size-3" /></button>}>
          <Item to="/agents" end icon={<Bot />} label="All agents" collapsed={collapsed} />
          {agents.slice(0, collapsed ? 3 : 6).map((a) => (
            <Item key={a.id} to={`/agents/${a.id}`} icon={<ModelLogo modelId={a.primaryModelId} size={11} plain className="!size-5" />} label={a.name} collapsed={collapsed} badge={a.status === "working" && !collapsed ? <span className="size-1.5 animate-pulse-soft rounded-full bg-cyan" /> : undefined} />
          ))}
        </Section>

        <Section title="Silent Code Sessions" count={runs.length} collapsed={collapsed}>
          {runs.slice(0, collapsed ? 3 : 6).map((r) => (
            <Item key={r.id} to={`/runs/${r.id}`} icon={<Cpu />} label={r.title} collapsed={collapsed} badge={!collapsed ? <RunStatusBadge status={r.status} size="xs" /> : undefined} />
          ))}
        </Section>

        {!collapsed && (
          <Section title="Recent Activity" collapsed={collapsed}>
            <ul className="px-2">
              {activity.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => a.refRoute && navigate(a.refRoute)} className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left hover:bg-ink-3/60">
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", a.ok ? "bg-success/70" : "bg-danger/70")} />
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] text-text-2">{a.title}</span>
                      <span className="block truncate text-[10px] text-text-3">{formatRelative(a.at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </nav>

      <div className={cn("border-t border-line p-2", collapsed && "flex flex-col items-center")}>
        <Item to="/memory" icon={<Brain />} label="Memory & Context" collapsed={collapsed} />
        <Item to="/phone" icon={<Smartphone />} label="Phone Link" collapsed={collapsed} />
        <Item to="/settings" icon={<Settings2 />} label="Settings" collapsed={collapsed} />
        {!collapsed && (
          <div className="mt-2 flex items-center gap-2 px-3 text-[10px] text-text-3">
            <MessageSquare className="size-3" />
            <span>v0.1.0 · Codex-native</span>
          </div>
        )}
      </div>
    </div>
  )
}
