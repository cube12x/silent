/**
 * Events streamed from the Rust runtime (crates/silent-runtime) for a single CLI execution.
 * Mirrors `RuntimeEvent` in Rust: `#[serde(tag = "type", content = "data", rename_all = "camelCase")]`.
 * Every CLI adapter (Codex, Claude Code, Kimi, Grok Build, Gemini, Qwen, OpenCode, Copilot, Cursor, Amp)
 * normalises its own output into this one shape.
 */
export type RuntimeEvent =
  | { type: "sessionStarted"; data: { sessionId: string } }
  | { type: "turnStarted"; data: Record<string, never> }
  | { type: "textDelta"; data: { text: string } }
  | { type: "agentMessage"; data: { text: string } }
  | { type: "commandStarted"; data: { command: string } }
  | { type: "commandCompleted"; data: { command: string; exitCode: number | null; outputTail: string } }
  | { type: "fileChanged"; data: { path: string; kind: "add" | "update" | "delete" } }
  | { type: "reasoningStatus"; data: { status: string } }
  | { type: "usage"; data: { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number } }
  | { type: "cost"; data: { usd: number } }
  | { type: "stderr"; data: { line: string } }
  | { type: "stdout"; data: { line: string } }
  | { type: "turnCompleted"; data: Record<string, never> }
  | { type: "failed"; data: { code: string; message: string; retryable: boolean } }
  | { type: "exited"; data: { code: number | null } }

export type SandboxMode = "read-only" | "workspace-write"

/** One CLI execution. `providerId` picks the adapter; the adapter builds argv and parses output. */
export interface CliRunRequest {
  runId: string
  providerId: ProviderId
  modelId?: string
  prompt: string
  cwd?: string
  sandbox: SandboxMode
  /** Outbound network for the worker's shell (package installs, fetches). Only meaningful with workspace-write; Codex enforces it, other CLIs do not sandbox the network. */
  network?: boolean
  /** Resume a previous session of this CLI (Codex thread id, Claude/Kimi/Gemini session id…). */
  resumeSessionId?: string
  /** One-shot: do not persist a resumable session where the CLI supports it. */
  ephemeral: boolean
  /** Ask the CLI for a review pass instead of a task (Codex `exec review`); others prepend a review brief. */
  review?: boolean
  /** Reasoning effort hint where the CLI supports it (codex/claude/kimi). */
  effort?: "low" | "medium" | "high" | "xhigh" | "max"
  /** Wall-clock limit for this CLI process; the runtime kills it and emits failed{code:"timeout"}. */
  timeoutSecs?: number
  /** JSON Schema the final answer must satisfy (Codex --output-schema, Claude --json-schema). */
  outputSchema?: Record<string, unknown>
}

export type ProviderId = "codex" | "claude" | "kimi" | "grok" | "gemini" | "qwen" | "opencode" | "copilot" | "cursor" | "amp" | "antigravity"

export const PROVIDER_IDS: readonly ProviderId[] = ["codex", "claude", "kimi", "grok", "gemini", "qwen", "opencode", "copilot", "cursor", "amp", "antigravity"] as const

export interface DetectedProvider {
  id: ProviderId
  binary: string
  installed: boolean
  version?: string
  path?: string
  error?: string
}

export type ModelSource = "catalog" | "config" | "alias" | "custom"
export type ModelTier = "frontier" | "strong" | "fast"

/** A model exposed by an installed CLI, discovered from its local catalog/config or added by the user. */
export interface ProviderModel {
  id: string
  providerId: ProviderId
  displayName: string
  source: ModelSource
  tier: ModelTier
  isDefault?: boolean
  /** Free-form metadata from the catalog (reasoning levels, context size…). */
  meta?: Record<string, string>
}

export type InstallMethod = "script" | "npm"

export interface RepoInfo {
  path: string
  exists: boolean
  isGitRepo: boolean
  name: string
  branch?: string
  fileCount?: number
  languages: string[]
}
