/**
 * Blueprint: a node/wire canvas where prompts, AIs, builds (folders) and buttons are wired together and
 * executed by real CLIs. Persisted as one JSON graph per blueprint.
 */
import type { CostMode, Effort } from "./runs"

export type BpNodeType = "prompt" | "ai" | "build" | "buildPhoto" | "button" | "variable" | "wizard" | "stub" | "check"
/** Asset kinds a Uydurma (placeholder) node can stand in for. */
export type BpStubKind = "image" | "sprite" | "tileset" | "sfx" | "music" | "voice" | "text" | "font" | "model3d" | "video"
export const BP_STUB_KINDS: BpStubKind[] = ["image", "sprite", "tileset", "sfx", "music", "voice", "text", "font", "model3d", "video"]
export type BpButtonKind = "start" | "send" | "reload" | "parallel"
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
  /** Orchestration: further models the planner may assign tasks to (`modelRef` is always part of the pool). */
  pool?: string[]
  /** Uncached tokens this node's runs consumed so far (accumulates across runs). */
  tokens?: number
  /** "Özel AI": base instructions prepended to every run (persona, rules); the wired prompt is the task. */
  instructions?: string
  /** "Özel AI": repositories cloned into `<build>/.silent/refs/<name>` before each run and listed in the brief. */
  repos?: BpAiRepo[]
  /** Bilinç = read-only investigator that writes a report; Eylem = applies the reports of the Bilinç nodes wired into it. */
  role?: BpAiRole
  /** Reasoning effort the run starts with (absent = Silent's per-task policy). Clamped to what each CLI accepts. */
  effort?: Effort
  /** Turbo: no polish round, effort ≤ medium, lean plan (orchestration) / single session capped at medium (Faz 3). */
  turbo?: boolean
  /** Mechanical: cheapest pool model for tests/docs/translation (orchestration only, Faz 3). */
  mechanical?: boolean
  /** Bilinç: the report of the last run (findings + numbered actions). */
  report?: string
  /** Tamirci AI box created from the Dosyalar tab (reused by later repair requests). */
  tamirci?: boolean
}
/** kesifci = cheap read-only scout whose `# RECON` report spares the next (expensive) AI from re-scanning the repo. */
export type BpAiRole = "bilinc" | "eylem" | "donusturucu" | "kesifci"
export interface BpAiRepo {
  /** `https://…` or `git@…` */
  url: string
  /** Folder name under .silent/refs (default: last URL segment). */
  name?: string
  /** One line telling the AI what this repo is for. */
  hint?: string
}
/** Denetçi: runs the project's own checks (typecheck/test/build) WITHOUT a model; a red result becomes the work order of the AI(s) wired after it. */
export interface BpCheckData {
  title?: string
  /** Shell commands run in order in the wired folder; empty = typecheck, test, build from package.json. */
  commands: string[]
  /** Lines of output kept from a failing command for the report. */
  maxLines: number
  timeoutSecs: number
  /** `# CHECK` report of the last run (fed to the wired fixer AI when red). */
  report?: string
  lastOk?: boolean
}
/** Uydurma: assets are registered as prompt-named placeholders (the name is the prompt); a cheaper AI fills them later. */
export interface BpStubData {
  title?: string
  kinds: BpStubKind[]
  /** Folder (relative to the build) holding the placeholders and uydurma.json. */
  folder: string
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
  | ({ type: "stub" } & BpStubData)
  | ({ type: "check" } & BpCheckData)

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

/** Saved defaults of the Dosyalar tab's Tamirci AI (model, base instructions, repos, effort). */
export interface TamirciPreset {
  modelRef: string
  instructions?: string
  repos?: BpAiRepo[]
  effort?: Effort
}

export interface Blueprint {
  id: string
  name: string
  nodes: BpNode[]
  edges: BpEdge[]
  viewport?: { x: number; y: number; zoom: number }
  /** Blueprint-level settings that are not nodes. */
  meta?: { tamirci?: TamirciPreset }
  createdAt: number
  updatedAt: number
}

/** Which node types may wire into which. */
export const BP_EDGE_RULES: Record<BpNodeType, BpNodeType[]> = {
  prompt: ["ai", "wizard"],
  ai: ["build", "buildPhoto", "ai", "stub", "check"],
  build: ["prompt", "button", "ai", "variable", "check"],
  buildPhoto: ["prompt", "button", "ai", "variable", "check"],
  button: ["ai", "build", "buildPhoto", "prompt"],
  variable: ["wizard", "ai"],
  wizard: ["ai"],
  // stub → ai: that AI must produce placeholders instead of real assets; ai → stub: that AI fills the placeholders.
  stub: ["ai"],
  // check → ai: the fixer(s) that run only when the check is red (the report is their work order).
  check: ["ai"],
}

export function canConnect(from: BpNodeType, to: BpNodeType): boolean {
  return BP_EDGE_RULES[from]?.includes(to) ?? false
}

/** Human labels used by the context menu and node headers (translated in the UI). */
export const BP_NODE_TYPES: BpNodeType[] = ["prompt", "ai", "build", "buildPhoto", "button", "variable", "wizard", "stub", "check"]
