import type { ProviderId, ProviderModel } from "@/domain/runtime"

export interface ProviderCapabilities {
  /** Emits structured JSONL we parse (vs. plain text). */
  streamJson: boolean
  /** Can resume a previous session by id. */
  resume: boolean
  /** Has a true read-only sandbox flag. Otherwise read-only is enforced by prompt only ("soft"). */
  readOnlySandbox: boolean
  /** Accepts a model flag. */
  modelFlag: boolean
  /** Worker shell can launch a real browser (Playwright/Chromium). False for CLIs whose sandbox forbids it (Codex: mach-port check-in denied, verified 2026-09-24). */
  browser: boolean
  /** Structured-output planning verified end to end (schema accepted, JSON returned). Only these CLIs plan. */
  planner: boolean
  /** Accepts an effort/reasoning flag. */
  effort: boolean
  /** The agent has a built-in raster image generation tool (Antigravity `generate_image`, verified 2026-09-26: a real PNG was saved). */
  image?: boolean
}

export interface ProviderInfo {
  id: ProviderId
  name: string
  vendor: string
  binary: string
  altBinaries: string[]
  /** Shell install command (script). */
  installScript?: string
  /** npm global install command. */
  installNpm?: string
  /** Command to run in a terminal to authenticate. */
  loginCommand: string
  docsUrl: string
  capabilities: ProviderCapabilities
  /** "verified": parser pinned to a real transcript fixture; "beta": written from docs + generic fallback. */
  parserMaturity: "verified" | "beta"
  /** The vendor stopped serving this CLI for consumer accounts: disabled by default, note explains. */
  retired?: boolean
  /** Models known without any local catalog (aliases / documented defaults). */
  staticModels: Array<Pick<ProviderModel, "id" | "displayName" | "tier"> & { isDefault?: boolean }>
  /** Accent colour for logos/chips. */
  color: string
  /** Short honest note shown in settings. */
  note?: string
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  codex: {
    id: "codex",
    name: "Codex CLI",
    vendor: "OpenAI",
    binary: "codex",
    altBinaries: [],
    installNpm: "npm install -g @openai/codex",
    installScript: "npm install -g @openai/codex",
    loginCommand: "codex login",
    docsUrl: "https://developers.openai.com/codex/cli",
    capabilities: { streamJson: true, resume: true, readOnlySandbox: true, modelFlag: true, effort: true, browser: false, planner: true },
    parserMaturity: "verified",
    staticModels: [],
    color: "#39d2ff",
  },
  claude: {
    id: "claude",
    name: "Claude Code",
    vendor: "Anthropic",
    binary: "claude",
    altBinaries: [],
    installScript: "curl -fsSL https://claude.ai/install.sh | bash",
    installNpm: "npm install -g @anthropic-ai/claude-code",
    loginCommand: "claude",
    docsUrl: "https://code.claude.com/docs/en/cli-reference",
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: true, browser: true, planner: true },
    parserMaturity: "verified",
    staticModels: [
      // Aliases resolve to the newest model of each line (verified 2026-09-24: opus → claude-opus-5-5).
      { id: "fable", displayName: "Claude Fable (latest)", tier: "frontier" },
      { id: "opus", displayName: "Claude Opus (latest)", tier: "frontier" },
      { id: "sonnet", displayName: "Claude Sonnet (latest)", tier: "strong" },
      { id: "haiku", displayName: "Claude Haiku (latest)", tier: "fast" },
      { id: "claude-opus-5-5", displayName: "Claude Opus 5.5", tier: "frontier" },
      { id: "claude-opus-5", displayName: "Claude Opus 5", tier: "frontier" },
      { id: "claude-sonnet-5", displayName: "Claude Sonnet 5", tier: "strong" },
      { id: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", tier: "fast" },
    ],
    color: "#e8b98a",
    note: "Runs with --permission-mode acceptEdits; read-only tasks are enforced by the brief.",
  },
  kimi: {
    id: "kimi",
    name: "Kimi Code",
    vendor: "Moonshot AI",
    binary: "kimi",
    altBinaries: [],
    installScript: "curl -fsSL https://code.kimi.com/install.sh | bash",
    installNpm: "npm install -g @kimi-code/cli",
    loginCommand: "kimi login",
    docsUrl: "https://moonshotai.github.io/kimi-code/",
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: false, browser: true, planner: false },
    parserMaturity: "verified",
    staticModels: [],
    color: "#7cf0c8",
    note: "Prompt mode runs with auto permissions; read-only is enforced by the brief.",
  },
  grok: {
    id: "grok",
    name: "Grok Build",
    vendor: "xAI",
    binary: "grok",
    altBinaries: [],
    installScript: "curl -fsSL https://x.ai/cli/install.sh | bash",
    installNpm: "npm install -g @xai-official/grok",
    loginCommand: "grok login",
    docsUrl: "https://docs.x.ai/build/overview",
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: true, browser: true, planner: false, image: true },
    parserMaturity: "verified",
    staticModels: [
      // Live catalog comes from `grok models` (~/.grok/models_cache.json); these are the 2026-09-25 defaults.
      { id: "grok-4.7", displayName: "Grok 4.7", tier: "frontier", isDefault: true },
      { id: "grok-4.7-build-fast", displayName: "Grok 4.7 Fast", tier: "strong" },
      { id: "grok-4.6", displayName: "Grok 4.6", tier: "frontier" },
      { id: "grok-4.5", displayName: "Grok 4.5", tier: "strong" },
    ],
    color: "#e6eaf0",
    note: "SuperGrok / X Premium+. Verified 2026-09-25: Claude-compatible JSONL stream, session resume, reasoning effort.",
  },
  gemini: {
    id: "gemini",
    name: "Gemini CLI",
    vendor: "Google",
    binary: "gemini",
    altBinaries: [],
    installNpm: "npm install -g @google/gemini-cli",
    installScript: "npm install -g @google/gemini-cli",
    loginCommand: "gemini",
    docsUrl: "https://github.com/google-gemini/gemini-cli",
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: false, browser: true, planner: false },
    parserMaturity: "beta",
    staticModels: [
      { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", tier: "frontier", isDefault: true },
      { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", tier: "fast" },
    ],
    color: "#7c9cff",
    retired: true,
    note: "Google closed Gemini CLI for individual / AI Pro / AI Ultra accounts on 2026-06-18 (login fails with 'This client is no longer supported'). Use Antigravity CLI instead; Gemini CLI still works with Code Assist Standard/Enterprise licences.",
  },
  qwen: {
    id: "qwen",
    name: "Qwen Code",
    vendor: "Alibaba",
    binary: "qwen",
    altBinaries: [],
    installNpm: "npm install -g @qwen-code/qwen-code",
    installScript: "npm install -g @qwen-code/qwen-code",
    loginCommand: "qwen",
    docsUrl: "https://qwenlm.github.io/qwen-code-docs/",
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: false, browser: true, planner: false },
    parserMaturity: "beta",
    staticModels: [{ id: "qwen3-coder-plus", displayName: "Qwen3 Coder Plus", tier: "strong", isDefault: true }],
    color: "#b58cff",
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    vendor: "SST",
    binary: "opencode",
    altBinaries: [],
    installNpm: "npm install -g opencode-ai",
    installScript: "curl -fsSL https://opencode.ai/install | bash",
    loginCommand: "opencode auth login",
    docsUrl: "https://opencode.ai/docs/cli/",
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: false, browser: true, planner: false },
    parserMaturity: "beta",
    staticModels: [],
    color: "#f5b342",
    note: "Model ids use provider/model form (e.g. anthropic/claude-sonnet-4).",
  },
  copilot: {
    id: "copilot",
    name: "Copilot CLI",
    vendor: "GitHub",
    binary: "copilot",
    altBinaries: [],
    installNpm: "npm install -g @github/copilot",
    installScript: "npm install -g @github/copilot",
    loginCommand: "copilot",
    docsUrl: "https://docs.github.com/en/copilot/reference/cli-command-reference",
    capabilities: { streamJson: true, resume: false, readOnlySandbox: false, modelFlag: true, effort: false, browser: true, planner: false },
    parserMaturity: "beta",
    staticModels: [],
    color: "#8bd5ff",
  },
  cursor: {
    id: "cursor",
    name: "Cursor Agent",
    vendor: "Cursor",
    binary: "agent",
    altBinaries: ["cursor-agent"],
    installScript: "curl https://cursor.com/install -fsS | bash",
    loginCommand: "agent login",
    docsUrl: "https://cursor.com/docs/cli/headless",
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: false, browser: true, planner: false },
    parserMaturity: "beta",
    staticModels: [],
    color: "#ff9ecb",
  },
  amp: {
    id: "amp",
    name: "Amp",
    vendor: "Sourcegraph",
    binary: "amp",
    altBinaries: [],
    installNpm: "npm install -g @ampcode/cli",
    installScript: "npm install -g @ampcode/cli",
    loginCommand: "amp login",
    docsUrl: "https://ampcode.com/manual",
    capabilities: { streamJson: true, resume: false, readOnlySandbox: false, modelFlag: false, effort: false, browser: true, planner: false },
    parserMaturity: "beta",
    staticModels: [],
    color: "#ff6b6b",
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity CLI",
    vendor: "Google",
    binary: "agy",
    altBinaries: [],
    installScript: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    loginCommand: "agy",
    docsUrl: "https://antigravity.google/docs/cli/install/",
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: true, browser: true, planner: false, image: true },
    parserMaturity: "beta",
    staticModels: [],
    color: "#7c9cff",
    note: "Successor of Gemini CLI for individual Google accounts. Sign in once by running `agy` in a terminal; then `agy models` lists the models (add them under Models if the catalog stays empty).",
  },
}

export const PROVIDER_LIST: ProviderInfo[] = Object.values(PROVIDERS)

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS[id]
}
