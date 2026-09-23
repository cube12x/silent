import { isTauri } from "./backend"

/**
 * Inside the desktop app, mirror console warnings/errors and uncaught errors into the Tauri log file
 * (`~/Library/Logs/<bundle-id>/` on macOS) so problems can be reported without devtools.
 */
export async function installLogBridge(): Promise<void> {
  if (!isTauri()) return
  try {
    const log = await import("@tauri-apps/plugin-log")
    const fmt = (args: unknown[]) => args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    const origWarn = console.warn.bind(console)
    const origError = console.error.bind(console)
    console.warn = (...args: unknown[]) => {
      origWarn(...args)
      void log.warn(fmt(args)).catch(() => {})
    }
    console.error = (...args: unknown[]) => {
      origError(...args)
      void log.error(fmt(args)).catch(() => {})
    }
    window.addEventListener("error", (e) => void log.error(`uncaught: ${e.message} @ ${e.filename}:${e.lineno}`).catch(() => {}))
    window.addEventListener("unhandledrejection", (e) => void log.error(`unhandled rejection: ${fmt([e.reason])}`).catch(() => {}))
    void log.info("Silent webview started").catch(() => {})
  } catch (err) {
    console.warn("log bridge unavailable", err)
  }
}
