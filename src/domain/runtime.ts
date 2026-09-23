/**
 * Events streamed from the Rust runtime (crates/silent-runtime) for a single CLI execution.
 * Mirrors `RuntimeEvent` in Rust: `#[serde(tag = "type", content = "data", rename_all = "camelCase")]`.
 */
export type RuntimeEvent =
  | { type: "threadStarted"; data: { threadId: string } }
  | { type: "turnStarted"; data: Record<string, never> }
  | { type: "textDelta"; data: { text: string } }
  | { type: "agentMessage"; data: { text: string } }
  | { type: "commandStarted"; data: { command: string } }
  | { type: "commandCompleted"; data: { command: string; exitCode: number | null; outputTail: string } }
  | { type: "fileChanged"; data: { path: string; kind: "add" | "update" | "delete" } }
  | { type: "reasoningStatus"; data: { status: string } }
  | {
      type: "usage"
      data: {
        inputTokens: number
        cachedInputTokens: number
        outputTokens: number
        totalTokens: number
      }
    }
  | { type: "stderr"; data: { line: string } }
  | { type: "stdout"; data: { line: string } }
  | { type: "turnCompleted"; data: Record<string, never> }
  | { type: "failed"; data: { code: string; message: string; retryable: boolean } }
  | { type: "exited"; data: { code: number | null } }

export type SandboxMode = "read-only" | "workspace-write"

export interface CodexRunRequest {
  runId: string
  prompt: string
  cwd?: string
  sandbox: SandboxMode
  /** Resume an existing Codex thread instead of starting a new one. */
  resumeThreadId?: string
  ephemeral: boolean
  model?: string
  /** Use `codex exec review` instead of a prompt. */
  review?: boolean
  skipGitRepoCheck?: boolean
}

export interface DetectedProvider {
  id: string
  binary: string
  installed: boolean
  version?: string
  path?: string
  error?: string
}

export interface RepoInfo {
  path: string
  exists: boolean
  isGitRepo: boolean
  name: string
  branch?: string
  fileCount?: number
  languages: string[]
}
