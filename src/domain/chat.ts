import type { GatewayProfile } from "./agents"
import type { ProviderId } from "./runtime"

/** mind = a MindMirror model's conversation (hidden from the Maker chat list). */
export type ChatKind = "standard" | "repo-agent" | "mind"
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
/** MindMirror: which half of the modded model wrote this message (rendered as a coloured actor chip). */
export interface MindActorBlock {
  type: "mind-actor"
  actor: "bilinc" | "eylem" | "memory"
  modelRef: string
  phase?: "act" | "plan"
}
export type MessageBlock = TaskCardBlock | ExecutionSummaryBlock | ContextBlock | MindActorBlock

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
  content: string
  blocks: MessageBlock[]
  usage?: TokenUsage
  costUsd?: number
  providerId?: ProviderId
  modelId?: string
  streaming?: boolean
  error?: string
  createdAt: number
}

export interface Chat {
  id: string
  title: string
  kind: ChatKind
  providerId: ProviderId
  modelId: string
  repoAgentId?: string
  repoPath?: string
  gatewayPrompt?: string
  gatewayProfile?: GatewayProfile
  /** CLI session to resume (Codex thread id, Claude/Kimi/Gemini session id). */
  sessionId?: string
  /** Project chat bound to a Silent Code run. */
  runId?: string
  pinned?: boolean
  createdAt: number
  updatedAt: number
}
