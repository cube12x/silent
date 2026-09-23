import type { Backend } from "./backend"
import { isTauri } from "./backend"
import { FakeBackend } from "./fakeBackend"

let instance: Backend | undefined

/** Resolve the host backend once. Browser dev and tests get the in-memory fake. */
export async function getBackend(): Promise<Backend> {
  if (instance) return instance
  const forceFake = import.meta.env.VITE_SILENT_FAKE_BACKEND === "1"
  if (isTauri() && !forceFake) {
    const { TauriBackend } = await import("./tauriBackend")
    instance = new TauriBackend()
  } else {
    instance = new FakeBackend()
  }
  return instance
}

/** Test seam. */
export function setBackend(backend: Backend | undefined): void {
  instance = backend
}

export type { Backend } from "./backend"
