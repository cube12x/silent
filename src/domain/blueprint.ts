/**
 * Blueprint: a node/wire canvas where prompts, AIs, builds (folders) and buttons are wired together and
 * executed by real CLIs. Persisted as one JSON graph per blueprint.
 */
import type { CostMode, Effort } from "./runs"

export type BpNodeType = "prompt" | "ai" | "build" | "buildPhoto" | "button" | "variable" | "wizard" | "stub" | "check" | "queue" | "snapshot" | "verify" | "budget" | "model"
/** Asset kinds a Uydurma (placeholder) node can stand in for. */
export type BpStubKind = "image" | "sprite" | "tileset" | "sfx" | "music" | "voice" | "text" | "font" | "model3d" | "video"
export const BP_STUB_KINDS: BpStubKind[] = ["image", "sprite", "tileset", "sfx", "music", "voice", "text", "font", "model3d", "video"]
export type BpButtonKind = "start" | "send" | "reload" | "parallel"
/** lite = Bölücü (Faz 4): an orchestration that plans only disjoint build tasks (Turbo, no review/tests/integration); a Dikiş AI stitches afterwards. */
export type BpAiMode = "orchestration" | "single" | "lite"
/** Orchestration-like modes (a planner + workers) versus one CLI session. */
export function isOrchestration(mode: BpAiMode | undefined): boolean {
  return mode === "orchestration" || mode === "lite"
}
/** `waiting`: a Model Plus box that stopped the chain until the user delivers its asset requests (2026-10-05). */
export type BpNodeStatus = "idle" | "running" | "done" | "failed" | "listening" | "waiting"

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
  /** Sıcak Oturum (Faz 4, single mode): every run resumes this box's last CLI session (files already read stay in context). */
  keepSession?: boolean
  /** Folder the stored session ran in: a session is only resumed in the same folder (2026-10-01: a Dikiş resumed a session from a stray empty build). */
  sessionCwd?: string
  /** Model that produced the stored session: it is resumed only on that model. */
  sessionModelRef?: string
  /** Single box waiting for a quota reset (ms): the box shows a live countdown. */
  quotaWaitUntil?: number
}
/** kesifci = cheap read-only scout whose `# RECON` report spares the next (expensive) AI from re-scanning the repo. */
/** dikis = stitch step (Faz 4): full suite + cross-area seams after a Bölücü, never a new feature. */
export type BpAiRole = "bilinc" | "eylem" | "donusturucu" | "kesifci" | "dikis"
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
  /** Commands that may fail without stopping the chain or calling the fixer (2026-10-04: e2e on a slow host); red ones are reported as warnings. */
  softCommands?: string[]
  /** Walk on to the non-Eylem boxes after this check even when it stays red after the fixer. */
  continueOnFail?: boolean
  /** Consecutive time-outs per soft command; at `SOFT_SKIP_AFTER_TIMEOUTS` the command is skipped until it is edited or passes. */
  softTimeouts?: Record<string, number>
  /** `# CHECK` report of the last run (fed to the wired fixer AI when red). */
  report?: string
  lastOk?: boolean
}
/** Sıra (Faz 4): the wired prompts run one after another in ONE CLI session of `modelRef` (each step resumes the previous). */
export interface BpQueueData {
  title?: string
  modelRef: string
  /** Summary lines of the last run, one per step. */
  report?: string
}
/** Anlık Görüntü (Faz 4): a git snapshot of the wired folder; "Geri al" restores it. */
export interface BpSnapshotData {
  title?: string
  /** Git ref of the last snapshot (refs/silent/snapshots/…). */
  ref?: string
  takenAt?: number
  folder?: string
}
/** Çoklu Tarayıcı (Faz 4): N browser lanes verified in parallel by `modelRef`; findings feed the wired fixer AI. */
export interface BpVerifyData {
  title?: string
  modelRef: string
  /** One lane per line: a screen/flow to play through. */
  lanes: string[]
  /** `# VERIFY` report of the last run (fed to the wired fixer when findings exist). */
  report?: string
  lastOk?: boolean
  /** Lanes that had findings in the last pass: a re-check after the fixer replays only these. */
  failedLanes?: string[]
  /** Tokens the lanes consumed (all passes), counted in the blueprint Σ since 2026-10-04. */
  tokens?: number
}
/** Bütçe (Faz 4): the wired AI's run is cancelled once its tokens pass `maxTokens`. */
export interface BpBudgetData {
  title?: string
  maxTokens: number
  /** Tokens the guarded run had spent when it last stopped (for the badge). */
  spent?: number
}
/** Model Plus (2026-10-05): kinds of assets the art director may request; one request = one subject = one packed sheet. */
export type ModelRequestKind = "sprite-sheet" | "texture" | "tileset" | "image" | "model3d" | "audio"
export type ModelRequestStatus = "pending" | "delivered" | "rejected" | "accepted"
export interface ModelRequest {
  id: string
  /** Subject slug and file stem (`mario`): frames are `<name>_<anim>_<NN>.png`, the sheet `<name>.png` + `<name>.json`. */
  name: string
  kind: ModelRequestKind
  subject: string
  animations?: Array<{ name: string; frames: number }>
  /** `WxH` of one frame as the renderer draws it. */
  frameSize?: string
  view?: string
  notes?: string
  /** Ready-to-paste prompt for the external image AI (one packed sheet). */
  sheetPrompt: string
  /** Folder under the build where the final files land. */
  target: string
  /** File/function that loads the placeholder today — where the integration AI wires the real asset. */
  codeHook?: string
  status: ModelRequestStatus
  delivered?: { path: string; at: number }
  /** Files the validator found on acceptance (real extensions; the manifest names these). */
  outputs?: string[]
  /** Why the last validation rejected it (or, on a forced accept, what was overridden). */
  reasons?: string[]
}
/** Model Plus: the asset contract box — writes the requests, waits for the user's deliveries, validates them, hands a `# MODEL` manifest on. */
export interface BpModelData {
  title?: string
  /** Art director + converter model. */
  modelRef: string
  /** Visual style every request must enforce (pixel art 16-bit, flat vector…). */
  style?: string
  /** Folder (relative to the build) holding `<name>/` targets and `inbox/`. */
  folder: string
  requests: ModelRequest[]
  /** `# MODEL` manifest of the accepted assets (the wired integration AI's brief). */
  report?: string
  lastOk?: boolean
  /** Default true: the chain waits until EVERY request is accepted. */
  strict?: boolean
  /** Strict off: the user pressed "Continue" with a partial contract (cleared by a new delivery or a relist). */
  continued?: boolean
  /** Tokens the director/converter sessions consumed (counted in the blueprint Σ). */
  tokens?: number
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
  | ({ type: "queue" } & BpQueueData)
  | ({ type: "snapshot" } & BpSnapshotData)
  | ({ type: "verify" } & BpVerifyData)
  | ({ type: "budget" } & BpBudgetData)
  | ({ type: "model" } & BpModelData)

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
  prompt: ["ai", "wizard", "queue"],
  ai: ["build", "buildPhoto", "ai", "stub", "check", "snapshot", "verify", "model"],
  build: ["prompt", "button", "ai", "variable", "check", "queue", "snapshot", "verify", "model"],
  buildPhoto: ["prompt", "button", "ai", "variable", "check", "queue", "snapshot", "verify", "model"],
  button: ["ai", "build", "buildPhoto", "prompt", "queue", "snapshot"],
  variable: ["wizard", "ai"],
  wizard: ["ai"],
  // stub → ai: that AI must produce placeholders instead of real assets; ai → stub: that AI fills the placeholders.
  stub: ["ai"],
  // check → ai: the fixer(s) that run only when the check is red (the report is their work order).
  check: ["ai"],
  // queue → build/ai: what the queued session produced, and what runs after it.
  queue: ["build", "ai"],
  // snapshot → ai/prompt/queue/button: the chain (or a Paralel fan-out) continues after the snapshot is taken.
  snapshot: ["ai", "prompt", "queue", "button"],
  // verify → ai: the fixer(s) that run only when the lanes found problems.
  verify: ["ai"],
  // budget → ai: the guarded box.
  budget: ["ai"],
  // model → ai: the integration AI that wires the accepted assets into the code (gets the `# MODEL` manifest).
  model: ["ai"],
}

export function canConnect(from: BpNodeType, to: BpNodeType): boolean {
  return BP_EDGE_RULES[from]?.includes(to) ?? false
}

/** Human labels used by the context menu and node headers (translated in the UI). */
export const BP_NODE_TYPES: BpNodeType[] = ["prompt", "ai", "build", "buildPhoto", "button", "variable", "wizard", "stub", "check", "queue", "snapshot", "verify", "budget", "model"]
