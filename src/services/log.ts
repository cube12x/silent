import { isTauri } from "./backend"

/**
 * Inside the desktop app, mirror console warnings/errors and uncaught errors into the Tauri log file
 * (`~/Library/Logs/<bundle-id>/Silent.log` on macOS) so problems can be reported without devtools.
 * Uses a plain command (`frontend_log`) so it does not depend on the log plugin's webview permissions.
 */
export async function installLogBridge(): Promise<void> {
  if (!isTauri()) return
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const send = (level: "info" | "warn" | "error", message: string) => {
      void invoke("frontend_log", { level, message: message.slice(0, 4000) }).catch(() => {})
    }
    const fmt = (args: unknown[]) =>
      args
        .map((a) => {
          if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`
          if (typeof a === "string") return a
          try {
            return JSON.stringify(a)
          } catch {
            return String(a)
          }
        })
        .join(" ")
    const origWarn = console.warn.bind(console)
    const origError = console.error.bind(console)
    console.warn = (...args: unknown[]) => {
      origWarn(...args)
      send("warn", fmt(args))
    }
    console.error = (...args: unknown[]) => {
      origError(...args)
      send("error", fmt(args))
    }
    window.addEventListener("error", (e) => send("error", `uncaught: ${e.message} @ ${e.filename}:${e.lineno}`))
    window.addEventListener("unhandledrejection", (e) => send("error", `unhandled rejection: ${fmt([e.reason])}`))
    send("info", `Silent webview started (${location.href})`)
  } catch (err) {
    console.warn("log bridge unavailable", err)
  }
}
