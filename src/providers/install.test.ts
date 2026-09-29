import { describe, expect, it } from "vitest"
import { installOptions, looksLikeNpmPermissionError } from "./install"
import { PROVIDERS } from "./registry"

describe("installOptions", () => {
  it("offers script then npm on unix, deduplicated", () => {
    expect(installOptions(PROVIDERS.claude, "macos").map((o) => o.method)).toEqual(["script", "npm"])
    expect(installOptions(PROVIDERS.codex, "linux").map((o) => o.method)).toEqual(["script"])
  })
  it("never runs curl|bash on Windows and leaves script-only CLIs to the docs", () => {
    expect(installOptions(PROVIDERS.claude, "windows")).toEqual([{ method: "npm", command: PROVIDERS.claude.installNpm }])
    expect(installOptions(PROVIDERS.antigravity, "windows")).toEqual([])
    expect(installOptions(PROVIDERS.cursor, "windows")).toEqual([])
  })
  it("recognises npm permission failures", () => {
    expect(looksLikeNpmPermissionError("npm ERR! Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules'")).toBe(true)
    expect(looksLikeNpmPermissionError("added 12 packages in 3s")).toBe(false)
  })
})
