import { describe, expect, it } from "vitest"
import { modKey, normalizePlatform, shellNotes, shellPathHint, shortcut } from "./platform"

describe("platform", () => {
  it("normalises the Rust OS names", () => {
    expect(normalizePlatform("macos")).toBe("macos")
    expect(normalizePlatform("windows")).toBe("windows")
    expect(normalizePlatform("linux")).toBe("linux")
    expect(normalizePlatform(undefined)).toBe("unknown")
  })
  it("labels shortcuts per platform", () => {
    expect(modKey("macos")).toBe("⌘")
    expect(modKey("windows")).toBe("Ctrl")
    expect(shortcut("N", "macos")).toBe("⌘N")
    expect(shortcut("N", "linux")).toBe("Ctrl+N")
  })
  it("gives a PATH hint the user can paste", () => {
    expect(shellPathHint("/home/a/.local/bin", "linux")).toBe('export PATH="/home/a/.local/bin:$PATH"')
    expect(shellPathHint("C:\\Users\\a\\bin", "windows")).toContain("setx PATH")
  })
  it("shell notes never tell Windows or Linux workers about macOS-only tools", () => {
    expect(shellNotes("macos")).toContain("gtimeout")
    expect(shellNotes("linux")).toContain("timeout 120")
    expect(shellNotes("windows")).toContain("PowerShell")
    expect(shellNotes("windows")).not.toContain("gtimeout")
  })
})
