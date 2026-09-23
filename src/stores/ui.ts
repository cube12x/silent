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
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: false,
  rightPanelOpen: true,
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
}))
