import { create } from "zustand"

export type NewSessionPreset = { kind: "standard" | "repo-agent"; repoAgentId?: string; nonce: number } | null

interface UiState {
  sidebarCollapsed: boolean
  rightPanelOpen: boolean
  paletteOpen: boolean
  newSession: NewSessionPreset
  drawer: { runId: string; subtaskId: string } | null
  toggleSidebar(): void
  setRightPanel(open: boolean): void
  toggleRightPanel(): void
  setPalette(open: boolean): void
  openNewSession(preset?: { kind: "standard" | "repo-agent"; repoAgentId?: string }): void
  closeNewSession(): void
  openDrawer(runId: string, subtaskId: string): void
  closeDrawer(): void
  /** Called on resize: collapses/expands shell chrome when crossing breakpoints. */
  applyViewport(width: number, previousWidth: number): void
}

/** Viewport breakpoints: below these the shell auto-collapses so content never overflows on small screens. */
export const RIGHT_PANEL_MIN_WIDTH = 1440
export const SIDEBAR_MIN_WIDTH = 1200

const initialWidth = typeof window !== "undefined" ? window.innerWidth : 1600

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: initialWidth < SIDEBAR_MIN_WIDTH,
  rightPanelOpen: initialWidth >= RIGHT_PANEL_MIN_WIDTH,
  paletteOpen: false,
  newSession: null,
  drawer: null,
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  setRightPanel: (open) => set({ rightPanelOpen: open }),
  toggleRightPanel: () => set({ rightPanelOpen: !get().rightPanelOpen }),
  setPalette: (open) => set({ paletteOpen: open }),
  openNewSession: (preset = { kind: "standard" }) => set({ newSession: { ...preset, nonce: Date.now() } }),
  closeNewSession: () => set({ newSession: null }),
  openDrawer: (runId, subtaskId) => set({ drawer: { runId, subtaskId } }),
  closeDrawer: () => set({ drawer: null }),
  applyViewport: (width, previousWidth) => {
    const patch: Partial<UiState> = {}
    if (width < RIGHT_PANEL_MIN_WIDTH && previousWidth >= RIGHT_PANEL_MIN_WIDTH) patch.rightPanelOpen = false
    if (width >= RIGHT_PANEL_MIN_WIDTH && previousWidth < RIGHT_PANEL_MIN_WIDTH) patch.rightPanelOpen = true
    if (width < SIDEBAR_MIN_WIDTH && previousWidth >= SIDEBAR_MIN_WIDTH) patch.sidebarCollapsed = true
    if (width >= SIDEBAR_MIN_WIDTH && previousWidth < SIDEBAR_MIN_WIDTH) patch.sidebarCollapsed = false
    if (Object.keys(patch).length) set(patch)
  },
}))
