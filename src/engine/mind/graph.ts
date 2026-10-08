/**
 * The MindMirror canvas compiled into what the engine runs. Pure.
 * - Model boxes wired from a Gateway form the mind; with no Gateway on the canvas every Model box counts.
 * - One Bilinç + one Eylem = a paired mind (Bilinç thinks, Eylem acts). A lone Model box (any role) = `single`: the chat
 *   talks to it directly, which is how a model is tested without a run.
 * - Araçlar wired to a Model applies to it; an unwired Araçlar applies to all. The last Araçlar's workspace wins.
 */
import type { MindEdge, MindGraph, MindModel, MindNode, MindNodeData, MindNodeType, MindRole, MindTools } from "@/domain"
import { DEFAULT_MIND_TOOLS, canConnectMind } from "@/domain"

export type MindWarning = "noModel" | "twoBilinc" | "twoEylem" | "unwiredModel" | "noModelRef" | "modelToModel" | "noWorkspace"

export interface MindComposition {
  kind: "pair" | "single" | "none"
  bilinc?: MindRole
  eylem?: MindRole
  /** The box used directly when `kind === "single"`. */
  single?: MindRole & { role: MindNodeData extends { type: "model" } ? never : "bilinc" | "eylem" | "tek"; nodeId: string }
  gateway: string
  tools: MindTools
  workspace?: string
  warnings: MindWarning[]
  /** Per-node warnings for the ▲ marker. */
  nodeWarnings: Record<string, MindWarning[]>
}

function modelNodes(g: MindGraph): Array<MindNode & { data: Extract<MindNodeData, { type: "model" }> }> {
  return g.nodes.filter((n): n is MindNode & { data: Extract<MindNodeData, { type: "model" }> } => n.data.type === "model")
}

export function validateMindEdge(g: MindGraph, from: string, to: string): string | null {
  const a = g.nodes.find((n) => n.id === from)
  const b = g.nodes.find((n) => n.id === to)
  if (!a || !b) return "missing"
  if (from === to) return "self"
  if (a.type === "model" && b.type === "model") return "modelToModel"
  if (!canConnectMind(a.type, b.type)) return "rule"
  if (g.edges.some((e) => e.from === from && e.to === to)) return "duplicate"
  return null
}

export function composeMind(model: Pick<MindModel, "graph">): MindComposition {
  const g = model.graph
  const warnings: MindWarning[] = []
  const nodeWarnings: Record<string, MindWarning[]> = {}
  const warn = (id: string | undefined, w: MindWarning) => {
    if (!warnings.includes(w)) warnings.push(w)
    if (id) (nodeWarnings[id] ??= []).push(w)
  }
  const gateways = g.nodes.filter((n) => n.type === "gateway")
  const gateway = gateways.map((n) => (n.data.type === "gateway" ? n.data.prompt : "")).filter((p) => p.trim()).join("\n\n")
  const gatewayIds = new Set(gateways.map((n) => n.id))
  const wiredFromGateway = new Set(g.edges.filter((e) => gatewayIds.has(e.from)).map((e) => e.to))
  const all = modelNodes(g)
  const members = gateways.length ? all.filter((n) => wiredFromGateway.has(n.id)) : all
  if (gateways.length) for (const n of all) if (!wiredFromGateway.has(n.id)) warn(n.id, "unwiredModel")
  for (const n of all) if (!n.data.modelRef) warn(n.id, "noModelRef")

  // Tools: wired ones apply to their models; an unwired one applies to everyone.
  const toolNodes = g.nodes.filter((n): n is MindNode & { data: Extract<MindNodeData, { type: "tools" }> } => n.data.type === "tools")
  let tools: MindTools = { ...DEFAULT_MIND_TOOLS }
  let workspace: string | undefined
  for (const t of toolNodes) {
    tools = { ...t.data.tools }
    if (t.data.workspace) workspace = t.data.workspace
  }

  const bilincs = members.filter((n) => n.data.role === "bilinc")
  const eylems = members.filter((n) => n.data.role === "eylem")
  if (bilincs.length > 1) for (const n of bilincs.slice(1)) warn(n.id, "twoBilinc")
  if (eylems.length > 1) for (const n of eylems.slice(1)) warn(n.id, "twoEylem")
  // The acting box's OFF switches (model card) cut the Araçlar tools for this model.
  const withOff = (box: (typeof all)[number] | undefined): MindTools => {
    const off = box?.data.off ?? {}
    return { browser: tools.browser && !off.browser, files: tools.files && !off.files, shell: tools.shell && !off.shell, network: tools.network && !off.network, image: tools.image && !off.image }
  }
  if (!members.length) {
    warn(undefined, "noModel")
    return { kind: "none", gateway, tools, warnings, nodeWarnings, workspace }
  }
  const bilinc = bilincs[0]
  const eylem = eylems[0]
  if (bilinc && eylem) {
    if (!workspace) warn(undefined, "noWorkspace")
    return { kind: "pair", bilinc: { modelRef: bilinc.data.modelRef, effort: bilinc.data.effort }, eylem: { modelRef: eylem.data.modelRef, effort: eylem.data.effort }, gateway, tools: withOff(eylem), warnings, nodeWarnings, workspace }
  }
  // Single: the only member (or the first one) is used directly.
  const one = bilinc ?? eylem ?? members[0]!
  return { kind: "single", single: { modelRef: one.data.modelRef, effort: one.data.effort, role: one.data.role as never, nodeId: one.id }, gateway, tools: withOff(one), warnings, nodeWarnings, workspace }
}

/** A Düşünme box on the canvas asks Bilinç to think aloud (DÜŞÜNCE block) and shows it live. */
export function hasThinking(g: MindGraph): boolean {
  return g.nodes.some((n) => n.type === "thinking")
}

/** Where a new box lands when added by the CLI / Start (to the right of the last box of that column). */
export function nextPosition(g: MindGraph, column: number): { x: number; y: number } {
  const x = 40 + column * 280
  const inColumn = g.nodes.filter((n) => Math.abs(n.x - x) < 20)
  const y = inColumn.length ? Math.max(...inColumn.map((n) => n.y)) + 170 : 60
  return { x, y }
}

/** The default canvas of a new model: Gateway → Bilinç, Gateway → Eylem, Hafıza → Gateway, Araçlar → Eylem. */
export function seedGraph(newId: () => string, refs: { bilinc?: string; eylem?: string; workspace?: string } = {}): MindGraph {
  const gateway: MindNode = { id: newId(), type: "gateway", x: 320, y: 150, data: { type: "gateway", prompt: "" } }
  const memory: MindNode = { id: newId(), type: "memory", x: 40, y: 150, data: { type: "memory" } }
  const bilinc: MindNode = { id: newId(), type: "model", x: 620, y: 40, data: { type: "model", role: "bilinc", modelRef: refs.bilinc ?? "" } }
  const eylem: MindNode = { id: newId(), type: "model", x: 620, y: 260, data: { type: "model", role: "eylem", modelRef: refs.eylem ?? "" } }
  const tools: MindNode = { id: newId(), type: "tools", x: 320, y: 360, data: { type: "tools", tools: { ...DEFAULT_MIND_TOOLS }, workspace: refs.workspace } }
  const edge = (from: MindNode, to: MindNode): MindEdge => ({ id: newId(), from: from.id, to: to.id })
  return { nodes: [memory, gateway, bilinc, eylem, tools], edges: [edge(memory, gateway), edge(gateway, bilinc), edge(gateway, eylem), edge(tools, eylem)] }
}

export function defaultNodeData(type: MindNodeType): MindNodeData {
  switch (type) {
    case "model":
      return { type: "model", role: "tek", modelRef: "" }
    case "gateway":
      return { type: "gateway", prompt: "" }
    case "memory":
      return { type: "memory" }
    case "tools":
      return { type: "tools", tools: { ...DEFAULT_MIND_TOOLS } }
    case "live":
      return { type: "live" }
    case "thinking":
      return { type: "thinking" }
  }
}
