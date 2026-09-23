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
  /** Accepts an effort/reasoning flag. */
  effort: boolean
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
    capabilities: { streamJson: true, resume: true, readOnlySandbox: true, modelFlag: true, effort: true },
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
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: true },
    parserMaturity: "verified",
    staticModels: [
      { id: "fable", displayName: "Claude Fable (latest)", tier: "frontier" },
      { id: "opus", displayName: "Claude Opus (latest)", tier: "frontier" },
      { id: "sonnet", displayName: "Claude Sonnet (latest)", tier: "strong" },
      { id: "haiku", displayName: "Claude Haiku (latest)", tier: "fast" },
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
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: false },
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
    loginCommand: "grok",
    docsUrl: "https://docs.x.ai/build/overview",
    capabilities: { streamJson: true, resume: false, readOnlySandbox: false, modelFlag: true, effort: false },
    parserMaturity: "beta",
    staticModels: [{ id: "grok-4.7", displayName: "Grok 4.7", tier: "frontier", isDefault: true }],
    color: "#e6eaf0",
    note: "SuperGrok / X Premium+ subscription. Session resume is not documented; each turn starts fresh.",
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
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: false },
    parserMaturity: "beta",
    staticModels: [
      { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", tier: "frontier", isDefault: true },
      { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", tier: "fast" },
    ],
    color: "#7c9cff",
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
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: false },
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
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: false },
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
    capabilities: { streamJson: true, resume: false, readOnlySandbox: false, modelFlag: true, effort: false },
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
    capabilities: { streamJson: true, resume: true, readOnlySandbox: false, modelFlag: true, effort: false },
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
    capabilities: { streamJson: true, resume: false, readOnlySandbox: false, modelFlag: false, effort: false },
    parserMaturity: "beta",
    staticModels: [],
    color: "#ff6b6b",
  },
}

export const PROVIDER_LIST: ProviderInfo[] = Object.values(PROVIDERS)

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS[id]
}
