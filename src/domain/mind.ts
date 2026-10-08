/**
 * MindMirror: a "modded model" = Bilinç (an expensive, read-only mind that thinks, finds and writes an EYLEM block when
 * action is needed) + Eylem (a cheaper model that executes that block: browser, research, code, files).
 * One row per model in `mind_models` (migration 0009); the chat lives in `chats`/`messages`, the memory in `memory_entries`.
 */
import type { GatewayProfile } from "./agents"
import type { Effort } from "./runs"

export type MindActor = "bilinc" | "eylem"
/** act = Bilinç may hand an EYLEM block to Eylem; plan = Eylem is skipped, Bilinç only plans. */
export type MindMode = "act" | "plan"
export type MindStatus = "draft" | "started"

/** What Eylem is allowed to touch (Araçlar button). `files=false` runs Eylem read-only. */
export interface MindTools {
  browser: boolean
  files: boolean
  shell: boolean
  network: boolean
  image: boolean
}
export const DEFAULT_MIND_TOOLS: MindTools = { browser: true, files: true, shell: true, network: true, image: false }

export interface MindRole {
  /** `provider:model` */
  modelRef: string
  effort?: Effort
}

/** CLI sessions resumed across turns: Bilinç and Eylem keep their own context; the terminal has a third. */
export interface MindSessions {
  bilinc?: string
  eylem?: string
  terminal?: string
}

export interface MindModel {
  id: string
  name: string
  status: MindStatus
  bilinc: MindRole
  eylem: MindRole
  tools: MindTools
  /** Gateway = the main mind: a prompt that is prepended to every brief; `profile` is derived from it on Start. */
  gateway: { prompt: string; profile?: GatewayProfile }
  /** Folder Eylem and the terminal work in. */
  workspace?: string
  mode: MindMode
  /** Chat (kind "mind") created on Start. */
  chatId?: string
  sessions: MindSessions
  createdAt: number
  updatedAt: number
  startedAt?: number
}

export function newMindModel(input: { id: string; name: string; now: number; bilincRef?: string; eylemRef?: string }): MindModel {
  return {
    id: input.id,
    name: input.name,
    status: "draft",
    bilinc: { modelRef: input.bilincRef ?? "" },
    eylem: { modelRef: input.eylemRef ?? "" },
    tools: { ...DEFAULT_MIND_TOOLS },
    gateway: { prompt: "" },
    mode: "act",
    sessions: {},
    createdAt: input.now,
    updatedAt: input.now,
  }
}
