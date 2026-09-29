import { create } from "zustand"

export interface Toast {
  id: number
  kind: "error" | "info"
  text: string
  /** Optional in-app link (e.g. the Setup screen when a planner CLI is missing). */
  action?: { label: string; to: string }
}

interface NotifyState {
  toasts: Toast[]
  push(kind: Toast["kind"], text: string, action?: Toast["action"]): void
  dismiss(id: number): void
}

const recent = new Map<string, number>()
const DEDUPE_MS = 30_000

/** Global, store-level notifications: anything that fails outside a screen's own UI lands here. */
export const useNotifyStore = create<NotifyState>((set) => ({
  toasts: [],
  push(kind, text, action) {
    const now = Date.now()
    const last = recent.get(text)
    if (last && now - last < DEDUPE_MS) return
    recent.set(text, now)
    const id = now + Math.random()
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, text, action }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 9000 : 4000)
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

/** Log and surface an error from a fire-and-forget promise. Planner-CLI errors link to the Setup screen. */
export function reportError(e: unknown, context?: string): void {
  const msg = e instanceof Error ? e.message : String(e)
  const text = context ? `${context}: ${msg}` : msg
  console.error(text)
  const action = /planner-capable CLI/i.test(msg) ? { label: "Setup", to: "/setup" } : undefined
  useNotifyStore.getState().push("error", text, action)
}
