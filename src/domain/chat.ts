import type { GatewayProfile } from "./agents"

export type ChatKind = "standard" | "repo-agent"

export type MessageRole = "user" | "assistant" | "system"

export interface TaskCardBlock {
  type: "task-card"
  title: string
  status: "running" | "done" | "failed"
  command?: string
  detail?: string
}

export interface ExecutionSummaryBlock {
  type: "execution-summary"
  title: string
  filesTouched: string[]
  commands: string[]
  durationMs: number
  tokens?: number
}

export interface ContextBlock {
  type: "context"
  label: string
  items: string[]
}

export type MessageBlock = TaskCardBlock | ExecutionSummaryBlock | ContextBlock

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens?: number
}

export interface Message {
  id: string
  chatId: string
  role: MessageRole
  /** Markdown body. */
  content: string
  blocks: MessageBlock[]
  usage?: TokenUsage
  modelId?: string
  streaming?: boolean
  error?: string
  createdAt: number
}

export interface Chat {
  id: string
  title: string
  kind: ChatKind
  modelId: string
  repoAgentId?: string
  repoPath?: string
  gatewayPrompt?: string
  gatewayProfile?: GatewayProfile
  /** Codex thread id for `codex exec resume`. */
  codexThreadId?: string
  pinned?: boolean
  createdAt: number
  updatedAt: number
}
