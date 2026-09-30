import type { Blueprint, BpEdge, BpNode, BpNodeType, BpStubData } from "@/domain"
import { canConnect } from "@/domain"
import { isRepoUrl } from "./prompt"

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

/** One step of a blueprint run: a single AI, or a Paralel button starting several AIs at once. */
export type BpStep = { kind: "ai"; node: BpNode } | { kind: "parallel"; button: BpNode; heads: BpNode[] } | { kind: "check"; node: BpNode } | { kind: "queue"; node: BpNode } | { kind: "snapshot"; node: BpNode } | { kind: "verify"; node: BpNode }

function isParallel(n: BpNode | undefined): boolean {
  return Boolean(n && n.data.type === "button" && n.data.kind === "parallel")
}

/** The AIs a Paralel button drives directly: wired AIs plus the AIs of its wired prompts (wire order). */
export function parallelHeads(bp: Blueprint, buttonId: string): BpNode[] {
  const heads: BpNode[] = []
  for (const t of outgoing(bp, buttonId)) {
    if (t.type === "ai") heads.push(t)
    else if (t.type === "prompt") heads.push(...outgoing(bp, t.id).filter((n) => n.type === "ai"))
  }
  return Array.from(new Map(heads.map((h) => [h.id, h])).values())
}

/**
 * The ordered steps a Start/Reload button (or a prompt, or a Paralel button) drives: follow wires forward
 * breadth-first; every AI met runs in turn, except that a Paralel button met on the way starts all of its heads
 * at once (its step is taken before sibling wires, so what is wired after a shared Build still waits for the
 * fan-out to finish). AIs already started by a fan-out are not run a second time.
 */
export function walkPlan(bp: Blueprint, startId: string): BpStep[] {
  const seen = new Set<string>()
  const started = new Set<string>()
  const plan: BpStep[] = []
  const queue = [startId]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = nodeById(bp, id)
    if (!node) continue
    if (isParallel(node)) {
      const heads = parallelHeads(bp, id).filter((h) => !started.has(h.id))
      if (heads.length) {
        plan.push({ kind: "parallel", button: node, heads })
        for (const h of heads) started.add(h.id)
      }
    } else if (node.type === "ai" && !started.has(id)) {
      plan.push({ kind: "ai", node })
      started.add(id)
    } else if (node.type === "check" && !started.has(id)) {
      // Denetçi: its own step; the AIs wired after it are fixers that run only when the check is red, so the walk stops here.
      plan.push({ kind: "check", node })
      started.add(id)
      continue
    } else if (node.type === "verify" && !started.has(id)) {
      // Çoklu Tarayıcı: same shape as Denetçi — the AIs after it fix only what the lanes found.
      plan.push({ kind: "verify", node })
      started.add(id)
      continue
    } else if ((node.type === "queue" || node.type === "snapshot") && !started.has(id)) {
      plan.push({ kind: node.type, node })
      started.add(id)
    } else if (node.type === "budget") {
      // Bütçe is a guard on the AI wired after it, not a step.
    }
    // Uydurma wires (ai → stub → ai) are policy markers, not flow: never walk through a stub, or a filler would
    // re-trigger the producer AI (2026-09-29: a Paralel fan-out walked filler → stub → Mimar and re-ran the whole orchestration).
    const next = outgoing(bp, id).filter((n) => n.type !== "stub")
    // Paralel buttons first: they are a barrier for everything else hanging off the same node.
    queue.push(...next.filter((n) => isParallel(n)).map((n) => n.id), ...next.filter((n) => !isParallel(n)).map((n) => n.id))
  }
  return plan
}

/** Every AI node `walkPlan` would run from `startId`, flattened in start order. */
export function aiChainFrom(bp: Blueprint, startId: string): BpNode[] {
  return walkPlan(bp, startId).flatMap((s) => (s.kind === "ai" ? [s.node] : s.kind === "parallel" ? s.heads : []))
}

/** Build the prompt text an AI node receives: its wired prompts (in wire order) + wired build folders as context. */
export function composeAiInput(bp: Blueprint, aiId: string): { prompt: string; buildFolders: string[]; promptTitles: string[]; stubs: BpStubData[]; fills: BpStubData[] } {
  const prompts = incoming(bp, aiId).filter((n) => n.type === "prompt")
  const builds = incoming(bp, aiId).filter((n) => n.type === "build" || n.type === "buildPhoto")
  // Builds wired into a prompt that feeds this AI also count as context — including through a button in between
  // (Build → Paralel/Start → prompt → AI). 2026-09-29: without this, fillers behind a Paralel button got no folder
  // and each started an empty project of its own.
  const isBuild = (n: BpNode) => n.type === "build" || n.type === "buildPhoto"
  const upstreamBuilds = (id: string): BpNode[] => {
    const direct = incoming(bp, id)
    return [...direct.filter(isBuild), ...direct.filter((n) => n.type === "button").flatMap((b) => incoming(bp, b.id).filter(isBuild))]
  }
  const viaPrompt = prompts.flatMap((p) => upstreamBuilds(p.id))
  const viaButton = incoming(bp, aiId).filter((n) => n.type === "button").flatMap((b) => incoming(bp, b.id).filter(isBuild))
  const folders = Array.from(new Set([...builds, ...viaPrompt, ...viaButton].map((b) => (b.data.type === "build" || b.data.type === "buildPhoto" ? b.data.folderPath : "")).filter(Boolean)))
  const text = prompts.map((p) => (p.data.type === "prompt" ? `${p.data.title ? `# ${p.data.title}\n` : ""}${p.data.text}` : "")).filter(Boolean).join("\n\n")
  // Uydurma: stub → ai makes this AI a placeholder producer; ai → stub makes it the filler.
  const stubs = incoming(bp, aiId).flatMap((n) => (n.data.type === "stub" ? [n.data] : []))
  const fills = outgoing(bp, aiId).flatMap((n) => (n.data.type === "stub" ? [n.data] : []))
  return { prompt: text, buildFolders: folders, promptTitles: prompts.map((p) => (p.data.type === "prompt" ? p.data.title : "")), stubs, fills }
}

/** Warnings the canvas shows on nodes (wiring that cannot work). */
export function lintBlueprint(bp: Blueprint): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const add = (id: string, msg: string) => {
    out[id] = [...(out[id] ?? []), msg]
  }
  for (const n of bp.nodes) {
    if (n.type === "ai") {
      // An Eylem's task is the wired Bilinç report; it needs no prompt of its own.
      const fedByBilinc = n.data.type === "ai" && n.data.role === "eylem" && incoming(bp, n.id).some((x) => x.data.type === "ai" && x.data.role === "bilinc")
      // A Dikiş's task is fixed by its policy (stitch + full suite); a fixer after a Denetçi/Çoklu Tarayıcı works from the report.
      const fedByReport = n.data.type === "ai" && (n.data.role === "dikis" || incoming(bp, n.id).some((x) => x.type === "check" || x.type === "verify"))
      if (!fedByBilinc && !fedByReport && !incoming(bp, n.id).some((x) => x.type === "prompt" || x.type === "wizard")) add(n.id, "ai.noPrompt")
      if (!n.data.type || (n.data.type === "ai" && !n.data.modelRef && !n.data.pool?.length)) add(n.id, "ai.noModel")
      if (n.data.type === "ai" && (n.data.repos ?? []).some((r) => r.url.trim() && !isRepoUrl(r.url))) add(n.id, "ai.badRepo")
      if (n.data.type === "ai" && n.data.role === "eylem" && !incoming(bp, n.id).some((x) => x.data.type === "ai" && x.data.role === "bilinc")) add(n.id, "eylem.noBilinc")
      if (n.data.type === "ai" && n.data.role === "bilinc" && !outgoing(bp, n.id).some((x) => x.data.type === "ai" && x.data.role === "eylem")) add(n.id, "bilinc.noEylem")
      if (n.data.type === "ai" && n.data.role === "donusturucu" && !incoming(bp, n.id).some((x) => x.type === "build" || x.type === "buildPhoto" || x.type === "stub" || x.type === "ai")) add(n.id, "donusturucu.noSource")
      if (n.data.type === "ai" && n.data.role === "kesifci" && !outgoing(bp, n.id).some((x) => x.type === "ai")) add(n.id, "kesifci.noNext")
    }
    if (n.type === "check" && !incoming(bp, n.id).some((x) => x.type === "build" || x.type === "buildPhoto" || x.type === "ai")) add(n.id, "check.noSource")
    if (n.type === "ai" && n.data.type === "ai" && n.data.role === "dikis" && !incoming(bp, n.id).some((x) => x.type === "build" || x.type === "buildPhoto" || x.type === "ai" || x.type === "verify")) add(n.id, "dikis.noSource")
    if (n.type === "queue") {
      if (!incoming(bp, n.id).some((x) => x.type === "prompt")) add(n.id, "queue.noPrompt")
      if (n.data.type === "queue" && !n.data.modelRef) add(n.id, "queue.noModel")
    }
    if (n.type === "snapshot" && !incoming(bp, n.id).some((x) => x.type === "build" || x.type === "buildPhoto" || x.type === "ai" || x.type === "button")) add(n.id, "snapshot.noSource")
    if (n.type === "verify") {
      if (!incoming(bp, n.id).some((x) => x.type === "build" || x.type === "buildPhoto" || x.type === "ai")) add(n.id, "verify.noSource")
      else if (n.data.type === "verify" && !n.data.lanes.some((l) => l.trim())) add(n.id, "verify.noLanes")
      else if (n.data.type === "verify" && !n.data.modelRef) add(n.id, "verify.noModel")
    }
    if (n.type === "budget" && !outgoing(bp, n.id).some((x) => x.type === "ai")) add(n.id, "budget.noAi")
    if (n.type === "stub" && !outgoing(bp, n.id).length && !incoming(bp, n.id).length) add(n.id, "stub.unwired")
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
  /** `silent bp auto "<goal>"`: let a planner-capable CLI design a new blueprint from this description. */
  auto?: string
  /** `silent bp fix <bp> "<problem>" [--file …]`: open the Dosyalar tab's Tamirci dialog prefilled. */
  fix?: { problem: string; files: string[] }
  /** `silent bp edit "<blueprint>" "<change>"`: let the designer modify that blueprint in place. */
  edit?: string
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
