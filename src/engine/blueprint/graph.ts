import type { Blueprint, BpEdge, BpNode, BpNodeType } from "@/domain"
import { canConnect } from "@/domain"

/** Pure graph helpers for the Blueprint executor and UI (no React, no backend). */

export function nodeById(bp: Blueprint, id: string | undefined): BpNode | undefined {
  return id ? bp.nodes.find((n) => n.id === id) : undefined
}

export function outgoing(bp: Blueprint, id: string): BpNode[] {
  return bp.edges.filter((e) => e.from === id).map((e) => nodeById(bp, e.to)).filter((n): n is BpNode => Boolean(n))
}

export function incoming(bp: Blueprint, id: string): BpNode[] {
  return bp.edges.filter((e) => e.to === id).map((e) => nodeById(bp, e.from)).filter((n): n is BpNode => Boolean(n))
}

export function firstOutgoing(bp: Blueprint, id: string, type: BpNodeType): BpNode | undefined {
  return outgoing(bp, id).find((n) => n.type === type)
}

export function firstIncoming(bp: Blueprint, id: string, type: BpNodeType): BpNode | undefined {
  return incoming(bp, id).find((n) => n.type === type)
}

export function validateEdge(bp: Blueprint, edge: Omit<BpEdge, "id">): string | null {
  const from = nodeById(bp, edge.from)
  const to = nodeById(bp, edge.to)
  if (!from || !to) return "missing-node"
  if (from.id === to.id) return "self"
  if (!canConnect(from.type, to.type)) return `no-rule:${from.type}->${to.type}`
  if (bp.edges.some((e) => e.from === edge.from && e.to === edge.to)) return "duplicate"
  return null
}

/**
 * The AI node a Start/Reload button (or a prompt) drives: follow wires forward until an AI is found.
 * Returns the ordered chain of AI nodes reachable from `startId` (each AI feeds the next through its build).
 */
export function aiChainFrom(bp: Blueprint, startId: string): BpNode[] {
  const seen = new Set<string>()
  const result: BpNode[] = []
  const queue = [startId]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = nodeById(bp, id)
    if (!node) continue
    if (node.type === "ai" && id !== startId) result.push(node)
    if (node.type === "ai" && id === startId) result.push(node)
    for (const next of outgoing(bp, id)) queue.push(next.id)
  }
  return result
}

/** Build the prompt text an AI node receives: its wired prompts (in wire order) + wired build folders as context. */
export function composeAiInput(bp: Blueprint, aiId: string): { prompt: string; buildFolders: string[]; promptTitles: string[] } {
  const prompts = incoming(bp, aiId).filter((n) => n.type === "prompt")
  const builds = incoming(bp, aiId).filter((n) => n.type === "build" || n.type === "buildPhoto")
  // Builds wired into a prompt that feeds this AI also count as context.
  const viaPrompt = prompts.flatMap((p) => incoming(bp, p.id).filter((n) => n.type === "build" || n.type === "buildPhoto"))
  const folders = Array.from(new Set([...builds, ...viaPrompt].map((b) => (b.data.type === "build" || b.data.type === "buildPhoto" ? b.data.folderPath : "")).filter(Boolean)))
  const text = prompts.map((p) => (p.data.type === "prompt" ? `${p.data.title ? `# ${p.data.title}\n` : ""}${p.data.text}` : "")).filter(Boolean).join("\n\n")
  return { prompt: text, buildFolders: folders, promptTitles: prompts.map((p) => (p.data.type === "prompt" ? p.data.title : "")) }
}

/** Warnings the canvas shows on nodes (wiring that cannot work). */
export function lintBlueprint(bp: Blueprint): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const add = (id: string, msg: string) => {
    out[id] = [...(out[id] ?? []), msg]
  }
  for (const n of bp.nodes) {
    if (n.type === "ai") {
      if (!incoming(bp, n.id).some((x) => x.type === "prompt" || x.type === "wizard")) add(n.id, "ai.noPrompt")
      if (!n.data.type || (n.data.type === "ai" && !n.data.modelRef && !n.data.pool?.length)) add(n.id, "ai.noModel")
    }
    if (n.type === "button" && n.data.type === "button") {
      if (!outgoing(bp, n.id).length) add(n.id, "button.unwired")
      if (n.data.kind === "reload" && !outgoing(bp, n.id).some((x) => x.type === "ai")) add(n.id, "reload.noAi")
      if (n.data.kind === "send" && (!incoming(bp, n.id).some((x) => x.type === "build" || x.type === "buildPhoto") || !outgoing(bp, n.id).length)) add(n.id, "send.unwired")
    }
    if (n.type === "variable" && !outgoing(bp, n.id).some((x) => x.type === "wizard" || x.type === "ai")) add(n.id, "variable.noTarget")
    if (n.type === "wizard" && !outgoing(bp, n.id).some((x) => x.type === "ai")) add(n.id, "wizard.noAi")
  }
  return out
}

/** `silent bp "<blueprint name|id>" ["<node title|id>"]` target; without a node the Start button (else the first prompt) runs. */
export interface AutorunRef {
  ref: string
  node?: string
  /** `silent bp answer …`: answer the node's blocked worker questions instead of triggering it. */
  answer?: string
  /** `silent bp only …`: run just this node, not the AIs wired after it. */
  only?: boolean
}

export function resolveAutorun(blueprints: Blueprint[], req: AutorunRef): { bp: Blueprint; node: BpNode } | undefined {
  const norm = (v: string) => v.trim().toLocaleLowerCase("tr")
  const bp = blueprints.find((b) => b.id === req.ref) ?? blueprints.find((b) => norm(b.name) === norm(req.ref))
  if (!bp) return undefined
  const titleOf = (n: BpNode) => ("title" in n.data && typeof n.data.title === "string" ? n.data.title : "")
  const want = req.node?.trim()
  const node = want
    ? (bp.nodes.find((n) => n.id === want) ?? bp.nodes.find((n) => norm(titleOf(n)) === norm(want)))
    : (bp.nodes.find((n) => n.data.type === "button" && n.data.kind === "start") ?? bp.nodes.find((n) => n.type === "prompt"))
  return node ? { bp, node } : undefined
}
