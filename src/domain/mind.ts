/**
 * MindMirror: a Blueprint-like canvas where boxes compose a "modded model" — Model boxes (one Bilinç, one Eylem, or a
 * single model to test directly), a Gateway (the main mind's prompt), the Hafıza deposu (pinned memory), Araçlar (what
 * Eylem may touch + workspace) and, after Start, a Canlı Hafıza box. Start compiles the graph into the fields the engine
 * runs with (`bilinc`, `eylem`, `gateway`, `tools`, `workspace`); the chat and terminal test the compiled model without
 * launching an orchestration run.
 * One row per model in `mind_models` (migration 0009); the chat lives in `chats`/`messages`, the memory in `memory_entries`.
 */
import type { GatewayProfile } from "./agents"
import type { Effort } from "./runs"

/** bilinc = read-only mind, eylem = acting half, tek = a single model used directly (testing a model from the chat). */
export type MindActor = "bilinc" | "eylem" | "tek"
/** act = Bilinç may hand an EYLEM block to Eylem; plan = Eylem is skipped, Bilinç only plans. */
export type MindMode = "act" | "plan"
export type MindStatus = "draft" | "started"

/** What Eylem is allowed to touch (Araçlar box). `files=false` runs Eylem read-only. */
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

// ---- Canvas -------------------------------------------------------------------------------------------------------

/** thinking = Düşünme box: shows Bilinç's thinking live (DÜŞÜNCE block + reasoning status lines) during a turn. */
export type MindNodeType = "model" | "gateway" | "memory" | "tools" | "live" | "thinking"
export type MindNodeData =
  | {
      type: "model"
      role: MindActor
      modelRef: string
      effort?: Effort
      title?: string
      /** Per-box switches OFF (the model card lists what this model can do; these turn pieces of it off for this box). */
      off?: Partial<Record<keyof MindTools, boolean>>
    }
  | { type: "gateway"; prompt: string }
  | { type: "memory" }
  | { type: "tools"; tools: MindTools; workspace?: string }
  | { type: "live" }
  | { type: "thinking" }
export interface MindNode {
  id: string
  type: MindNodeType
  x: number
  y: number
  data: MindNodeData
}
export interface MindEdge {
  id: string
  from: string
  to: string
}
export interface MindGraph {
  nodes: MindNode[]
  edges: MindEdge[]
  viewport?: { x: number; y: number; zoom: number }
}
/** Which boxes may wire into which: Gateway → Model (the model joins the mind), Hafıza → Gateway, Araçlar → Model. Two Model boxes never wire to each other. */
export const MIND_EDGE_RULES: Record<MindNodeType, MindNodeType[]> = {
  gateway: ["model"],
  memory: ["gateway", "model"],
  tools: ["model"],
  model: [],
  live: [],
  thinking: [],
}
export function canConnectMind(from: MindNodeType, to: MindNodeType): boolean {
  return MIND_EDGE_RULES[from]?.includes(to) ?? false
}
export const MIND_NODE_TYPES: MindNodeType[] = ["model", "gateway", "memory", "tools", "thinking"]

export interface MindModel {
  id: string
  name: string
  status: MindStatus
  graph: MindGraph
  /** Compiled from the graph on Start / before every turn (see composeMind). */
  bilinc: MindRole
  eylem: MindRole
  tools: MindTools
  gateway: { prompt: string; profile?: GatewayProfile }
  /** Folder Eylem and the terminal work in. */
  workspace?: string
  mode: MindMode
  /** Chat (kind "mind") created on Start. */
  chatId?: string
  sessions: MindSessions
  /** Uncached tokens all turns and terminal runs of this model consumed (Σ badge). */
  tokens?: number
  createdAt: number
  updatedAt: number
  startedAt?: number
}

export function newMindModel(input: { id: string; name: string; now: number; bilincRef?: string; eylemRef?: string }): MindModel {
  return {
    id: input.id,
    name: input.name,
    status: "draft",
    graph: { nodes: [], edges: [] },
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
