import type { Backend } from "./backend"
import { isTauri } from "./backend"

let instance: Backend | undefined

/** Resolve the host backend once. Outside Tauri (unit tests) the in-memory TestBackend is used. */
export async function getBackend(): Promise<Backend> {
  if (instance) return instance
  if (isTauri()) {
    const { TauriBackend } = await import("./tauriBackend")
    instance = new TauriBackend()
  } else {
    const { TestBackend } = await import("./testBackend")
    const test = new TestBackend()
    instance = import.meta.env.DEV && import.meta.env.VITE_SILENT_PREVIEW === "1" ? test.enablePreview() : test
  }
  return instance
}

export function setBackend(backend: Backend | undefined): void {
  instance = backend
}

export type { Backend } from "./backend"
