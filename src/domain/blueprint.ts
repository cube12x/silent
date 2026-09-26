/**
 * Blueprint: a node/wire canvas where prompts, AIs, builds (folders) and buttons are wired together and
 * executed by real CLIs. Persisted as one JSON graph per blueprint.
 */
import type { CostMode } from "./runs"

export type BpNodeType = "prompt" | "ai" | "build" | "buildPhoto" | "button" | "variable" | "wizard"
export type BpButtonKind = "start" | "send" | "reload"
export type BpAiMode = "orchestration" | "single"
export type BpNodeStatus = "idle" | "running" | "done" | "failed" | "listening"

export interface BpPromptData {
  title: string
  text: string
}
export interface BpAiData {
  title?: string
  /** `provider:model` */
  modelRef: string
  mode: BpAiMode
  costMode?: CostMode
  kitId?: string
  /** Purpose used by Reload and by wizards ("regenerate broken images"). */
  purpose?: string
}
export interface BpBuildData {
  title: string
  folderPath: string
  kind: "code" | "photo"
  lastRunId?: string
  fileCount?: number
  description?: string
}
export interface BpButtonData {
  kind: BpButtonKind
}
export interface BpVariableData {
  /** Node id of the build being watched. */
  watchNodeId?: string
  /** Glob-ish filter such as `*.png`. */
  filter?: string
  lastEvent?: { kind: "added" | "changed" | "removed"; path: string; at: number }
}
export interface BpWizardData {
  title?: string
  modelRef: string
  purpose: string
}

export type BpNodeData =
  | ({ type: "prompt" } & BpPromptData)
  | ({ type: "ai" } & BpAiData)
  | ({ type: "build" } & BpBuildData)
  | ({ type: "buildPhoto" } & BpBuildData)
  | ({ type: "button" } & BpButtonData)
  | ({ type: "variable" } & BpVariableData)
  | ({ type: "wizard" } & BpWizardData)

export interface BpNode {
  id: string
  type: BpNodeType
  x: number
  y: number
  data: BpNodeData
  status?: BpNodeStatus
  /** Run id (orchestration) or chat id (single) of the latest execution. */
  executionId?: string
  note?: string
}

export interface BpEdge {
  id: string
  from: string
  to: string
}

export interface Blueprint {
  id: string
  name: string
  nodes: BpNode[]
  edges: BpEdge[]
  viewport?: { x: number; y: number; zoom: number }
  createdAt: number
  updatedAt: number
}

/** Which node types may wire into which. */
export const BP_EDGE_RULES: Record<BpNodeType, BpNodeType[]> = {
  prompt: ["ai", "wizard"],
  ai: ["build", "buildPhoto", "ai"],
  build: ["prompt", "button", "ai", "variable"],
  buildPhoto: ["prompt", "button", "ai", "variable"],
  button: ["ai", "build", "buildPhoto", "prompt"],
  variable: ["wizard", "ai"],
  wizard: ["ai"],
}

export function canConnect(from: BpNodeType, to: BpNodeType): boolean {
  return BP_EDGE_RULES[from]?.includes(to) ?? false
}

/** Human labels used by the context menu and node headers (translated in the UI). */
export const BP_NODE_TYPES: BpNodeType[] = ["prompt", "ai", "build", "buildPhoto", "button", "variable", "wizard"]
