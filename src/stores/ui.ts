import { create } from "zustand"

export type NewSessionPreset = { kind: "standard" | "repo-agent"; repoAgentId?: string; nonce: number } | null

export const SIDEBAR_MIN_WIDTH = 1100

const initialWidth = typeof window !== "undefined" ? window.innerWidth : 1600

interface UiState {
  sidebarCollapsed: boolean
  paletteOpen: boolean
  newSession: NewSessionPreset
  drawer: { runId: string; subtaskId: string } | null
  toggleSidebar(): void
  setPalette(open: boolean): void
  openNewSession(preset?: { kind: "standard" | "repo-agent"; repoAgentId?: string }): void
  closeNewSession(): void
  openDrawer(runId: string, subtaskId: string): void
  closeDrawer(): void
  applyViewport(width: number, previousWidth: number): void
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: initialWidth < SIDEBAR_MIN_WIDTH,
  paletteOpen: false,
  newSession: null,
  drawer: null,
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  setPalette: (open) => set({ paletteOpen: open }),
  openNewSession: (preset = { kind: "standard" }) => set({ newSession: { ...preset, nonce: Date.now() } }),
  closeNewSession: () => set({ newSession: null }),
  openDrawer: (runId, subtaskId) => set({ drawer: { runId, subtaskId } }),
  closeDrawer: () => set({ drawer: null }),
  applyViewport: (width, previousWidth) => {
    if (width < SIDEBAR_MIN_WIDTH && previousWidth >= SIDEBAR_MIN_WIDTH) set({ sidebarCollapsed: true })
    if (width >= SIDEBAR_MIN_WIDTH && previousWidth < SIDEBAR_MIN_WIDTH) set({ sidebarCollapsed: false })
  },
}))
