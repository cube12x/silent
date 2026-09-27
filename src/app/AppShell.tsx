import * as React from "react"
import { Outlet, useLocation, useNavigate } from "react-router"
import { getBackend } from "@/services"
import { useRunsStore } from "@/stores/runs"
import { useBlueprintsStore } from "@/stores/blueprints"
import { Sidebar } from "./Sidebar"
import { TopBar } from "./TopBar"
import { CommandPalette } from "./CommandPalette"
import { NewSessionModal } from "@/features/new-session-modal/NewSessionModal"
import { TerminalDrawer } from "@/features/silent-code/TerminalDrawer"
import { useUiStore } from "@/stores/ui"

/** Two-column shell: sidebar | main, with a 48px top bar. No right panel in v2. */
export function AppShell() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const setPalette = useUiStore((s) => s.setPalette)
  const openNewSession = useUiStore((s) => s.openNewSession)
  const applyViewport = useUiStore((s) => s.applyViewport)
  const location = useLocation()
  const navigate = useNavigate()

  // `silent run <folder> "<request>"` from the terminal: the launcher wrote autostart.json; pick it up and
  // hand it to the composer, which plans, approves and starts without clicks.
  React.useEffect(() => {
    let stopped = false
    const poll = async () => {
      try {
        const req = await (await getBackend()).autostartTake()
        if (req && !stopped) {
          console.warn("[autostart] picked up", JSON.stringify({ folder: req.folder, promptLen: req.prompt?.length, kit: req.kit, cost: req.cost, polish: req.polish, blueprint: req.blueprint }))
          if (req.reload) {
            window.location.reload()
            return
          }
          if (req.blueprint?.ref) {
            useBlueprintsStore.setState({ autorun: req.blueprint })
            navigate(`/blueprint?auto=${Date.now()}`)
          } else if (req.prompt && req.folder) {
            useRunsStore.setState({ autostart: req })
            navigate(`/code?auto=${Date.now()}`)
          }
        }
      } catch {
        /* dev backend has none */
      }
    }
    void poll()
    const t = setInterval(() => void poll(), 3000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [navigate])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPalette(true)
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault()
        openNewSession({ kind: "standard" })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setPalette, openNewSession])

  React.useEffect(() => {
    let previous = window.innerWidth
    const onResize = () => {
      applyViewport(window.innerWidth, previous)
      previous = window.innerWidth
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [applyViewport])

  return (
    <div className="grid h-screen w-screen grid-rows-[48px_minmax(0,1fr)] overflow-hidden bg-ink-0 text-text-1" style={{ gridTemplateColumns: `${sidebarCollapsed ? 64 : 244}px minmax(0,1fr)` }}>
      <div className="col-span-2 row-start-1"><TopBar /></div>
      <aside className="row-start-2 min-h-0 border-r border-line bg-ink-1"><Sidebar /></aside>
      <main key={location.pathname.split("/")[1]} className="relative row-start-2 min-h-0 min-w-0 overflow-hidden">
        <div className="pointer-events-none absolute inset-0  opacity-[0.3]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 " />
        <div className="relative h-full min-h-0 overflow-auto"><Outlet /></div>
      </main>
      <CommandPalette />
      <NewSessionModal />
      <TerminalDrawer />
    </div>
  )
}
