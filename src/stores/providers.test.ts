import { beforeEach, describe, expect, it } from "vitest"
import { setBackend } from "@/services"
import { TestBackend } from "@/services/testBackend"
import { useProvidersStore } from "./providers"
import { useSettingsStore } from "./settings"

/** Exact JSON shape the Rust `providers_detect` command returned on this machine (2026-09-23). */
const RUST_DETECT = JSON.parse(
  '[{"id":"codex","binary":"codex","installed":true,"version":"0.153.2","path":"/opt/homebrew/bin/codex"},{"id":"claude","binary":"claude","installed":true,"version":"2.1.280","path":"/Users/cube/.local/bin/claude"},{"id":"kimi","binary":"kimi","installed":true,"version":"0.34.0","path":"/Users/cube/.kimi-code/bin/kimi"},{"id":"grok","binary":"grok","installed":false},{"id":"gemini","binary":"gemini","installed":false},{"id":"qwen","binary":"qwen","installed":false},{"id":"opencode","binary":"opencode","installed":false},{"id":"copilot","binary":"copilot","installed":false},{"id":"cursor","binary":"agent","installed":false},{"id":"amp","binary":"amp","installed":false}]',
)

describe("providers store", () => {
  beforeEach(() => {
    const backend = new TestBackend()
    backend.detected = RUST_DETECT
    backend.models = { codex: [{ id: "gpt-6-astra", providerId: "codex", displayName: "GPT-6-Astra", source: "catalog", tier: "frontier", isDefault: true }] }
    setBackend(backend)
  })

  it("marks installed CLIs, merges catalog + alias models and picks a default", async () => {
    await useSettingsStore.getState().load()
    await useProvidersStore.getState().load()
    const p = useProvidersStore.getState().providers
    expect(p.codex.installed).toBe(true)
    expect(p.claude.installed).toBe(true)
    expect(p.grok.installed).toBe(false)
    expect(p.codex.models.map((m) => m.id)).toContain("gpt-6-astra")
    expect(p.claude.models.map((m) => m.id)).toEqual(expect.arrayContaining(["fable", "opus", "sonnet", "haiku"]))
    expect(useProvidersStore.getState().lastError).toBeUndefined()
    expect(useSettingsStore.getState().settings.defaultModelRef).toBe("codex:gpt-6-astra")
    expect(useProvidersStore.getState().availableModels().length).toBeGreaterThan(4)
  })
})
