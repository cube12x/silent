import * as React from "react"
import { Outlet, useLocation } from "react-router"
import { cn } from "cn"
import { Sidebar } from "./Sidebar"
import { TopBar } from "./TopBar"
import { RightPanel } from "./RightPanel"
import { CommandPalette } from "./CommandPalette"
import { NewSessionModal } from "@/features/new-session-modal/NewSessionModal"
import { TerminalDrawer } from "@/features/terminal-drawer/TerminalDrawer"
import { useUiStore } from "@/stores/ui"

/** 3-column shell: sidebar | main | intelligence panel, with a 48px top bar. */
export function AppShell() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen)
  const setPalette = useUiStore((s) => s.setPalette)
  const openNewSession = useUiStore((s) => s.openNewSession)
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel)
  const applyViewport = useUiStore((s) => s.applyViewport)
  const location = useLocation()

  React.useEffect(() => {
    let previous = window.innerWidth
    const onResize = () => {
      applyViewport(window.innerWidth, previous)
      previous = window.innerWidth
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [applyViewport])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPalette(true)
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault()
        openNewSession({ kind: "standard" })
      } else if (mod && e.key === ".") {
        e.preventDefault()
        toggleRightPanel()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setPalette, openNewSession, toggleRightPanel])

  return (
    <div
      className={cn("grid h-screen w-screen overflow-hidden bg-ink-0 text-text-1", "grid-rows-[48px_minmax(0,1fr)]")}
      style={{ gridTemplateColumns: `${sidebarCollapsed ? 64 : 264}px minmax(0,1fr) ${rightPanelOpen ? 360 : 0}px` }}
    >
      <div className="col-span-3 row-start-1"><TopBar /></div>
      <aside className="row-start-2 min-h-0 border-r border-line bg-ink-1"><Sidebar /></aside>
      <main key={location.pathname} className="relative row-start-2 min-h-0 min-w-0 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-[0.35]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklch,var(--cyan)_10%,transparent),transparent)]" />
        <div className="relative h-full min-h-0 overflow-auto"><Outlet /></div>
      </main>
      <aside className={cn("row-start-2 min-h-0 overflow-hidden border-l border-line bg-ink-1 transition-[width]", !rightPanelOpen && "border-l-0")}>{rightPanelOpen && <RightPanel />}</aside>
      <CommandPalette />
      <NewSessionModal />
      <TerminalDrawer />
    </div>
  )
}
