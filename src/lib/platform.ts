/** Host platform as reported by the Rust side (`app_info().platform`); "unknown" in the browser preview. */
export type Platform = "macos" | "windows" | "linux" | "unknown"

let current: Platform = "unknown"

/** Called once at bootstrap with `std::env::consts::OS` ("macos" | "windows" | "linux" | …). */
export function initPlatform(raw: string | undefined): Platform {
  current = normalizePlatform(raw)
  return current
}

export function normalizePlatform(raw: string | undefined): Platform {
  switch ((raw ?? "").toLowerCase()) {
    case "macos":
    case "darwin":
      return "macos"
    case "windows":
    case "win32":
      return "windows"
    case "linux":
      return "linux"
    default:
      return "unknown"
  }
}

export function platform(): Platform {
  return current
}

export function isMac(): boolean {
  return current === "macos"
}

export function isWindows(): boolean {
  return current === "windows"
}

/** The modifier glyph for shortcuts: ⌘ on macOS, Ctrl elsewhere. */
export function modKey(p: Platform = current): string {
  return p === "macos" ? "⌘" : "Ctrl"
}

/** `⌘N` / `Ctrl+N`. */
export function shortcut(key: string, p: Platform = current): string {
  return p === "macos" ? `⌘${key}` : `Ctrl+${key}`
}

/** How to put a directory on PATH on this platform (shown when the `silent` launcher dir is not on PATH). */
export function shellPathHint(dir: string, p: Platform = current): string {
  if (p === "windows") return `setx PATH "%PATH%;${dir}"`
  return `export PATH="${dir}:$PATH"`
}

/** Shell facts the worker brief carries so a CLI does not reach for tools the host lacks. */
export function shellNotes(p: Platform = current): string {
  switch (p) {
    case "windows":
      return "Shell notes: Windows — commands run in PowerShell/cmd (no `timeout`, use `Start-Process`/`Start-Job` for background servers; prefer forward slashes in paths passed to node tools); long-running servers must be started in the background and stopped before you finish."
    case "linux":
      return "Shell notes: Linux — GNU coreutils are available (`timeout 120 cmd…`); long-running servers must be started in the background and stopped before you finish."
    default:
      return "Shell notes: macOS — there is no `timeout` command (use `gtimeout` if present, or `perl -e 'alarm shift; exec @ARGV' 120 cmd…`); long-running servers must be started in the background and stopped before you finish."
  }
}
