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
export type BpStep = { kind: "ai"; node: BpNode } | { kind: "parallel"; button: BpNode; heads: BpNode[] } | { kind: "check"; node: BpNode } | { kind: "queue"; node: BpNode } | { kind: "snapshot"; node: BpNode } | { kind: "verify"; node: BpNode } | { kind: "model"; node: BpNode }

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
  const startNode = nodeById(bp, startId)
  // Only a walk from Start means "run everything again"; a Run on the hub Build itself continues the pipeline.
  const cycleGuard = !!startNode && !(startNode.data.type === "button" && startNode.data.kind === "start")
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
      // Denetçi: its own step. Eylem boxes wired after it are fixers (run only when red); anything else wired after it
      // is the continuation and runs when the check passes (2026-10-04: Dikiş → Denetçi → next stage, no scripts).
      plan.push({ kind: "check", node })
      started.add(id)
    } else if (node.type === "verify" && !started.has(id)) {
      // Çoklu Tarayıcı: same shape as Denetçi.
      plan.push({ kind: "verify", node })
      started.add(id)
    } else if (node.type === "model" && !started.has(id)) {
      // Model Plus: its own step; the walk STOPS here while the box waits for the user's assets and resumes from it.
      plan.push({ kind: "model", node })
      started.add(id)
    } else if ((node.type === "queue" || node.type === "snapshot") && !started.has(id)) {
      plan.push({ kind: node.type, node })
      started.add(id)
    } else if (node.type === "budget") {
      // Bütçe is a guard on the AI wired after it, not a step.
    }
    // Uydurma wires (ai → stub → ai) are policy markers, not flow: never walk through a stub, or a filler would
    // re-trigger the producer AI (2026-09-29: a Paralel fan-out walked filler → stub → Mimar and re-ran the whole orchestration).
    // Context-only wires: a Build → AI wire into a fixer (an AI fed by a check/verify) or into an AI that sits behind a
    // snapshot/queue only gives that AI its folder — it must not START it. 2026-10-01: one Build hub fanned every
    // trigger out into every stage's fixers and stitchers (Eylem boxes failed with "no prompt", stages re-ran).
    // A Tamirci box (repair request) is started only by the Dosyalar tab / `silent bp fix`: its Build wire is context.
    // 2026-10-04: a running Tamirci sat on the hub and the "already running" guard refused the next stage's trigger.
    const contextOnly = (from: BpNode, to: BpNode) => (from.type === "build" || from.type === "buildPhoto") && to.type === "ai" && (to.data.type === "ai" && to.data.tamirci === true || incoming(bp, to.id).some((x) => x.type === "check" || x.type === "verify" || x.type === "snapshot" || x.type === "queue" || x.type === "model"))
    // Stages meet at a shared Build hub. A walk that passes through or starts at the hub (anything but Start) must
    // not leave it into stages that already ran: Build → prompt → done AI, Build → done snapshot…
    // 2026-10-02: Bölücü → Build → every stage's entry prompt re-ran the whole blueprint (Büyük Güncelleme, Online, El…).
    const fromHub = node.type === "build" || node.type === "buildPhoto"
    const isFixer = (n: BpNode) => n.type === "ai" && n.data.type === "ai" && (n.data.role === "eylem" || n.data.tamirci === true)
    const afterGate = node.type === "check" || node.type === "verify"
    const next = outgoing(bp, id).filter((n) => n.type !== "stub" && !contextOnly(node, n) && !(afterGate && isFixer(n)) && !(cycleGuard && fromHub && n.id !== startId && alreadyRan(bp, n)))
    // Paralel buttons first: they are a barrier for everything else hanging off the same node.
    queue.push(...next.filter((n) => isParallel(n)).map((n) => n.id), ...next.filter((n) => !isParallel(n)).map((n) => n.id))
  }
  return plan
}

/** A node that already produced a result (done or failed); a prompt counts once every AI it feeds has. */
function alreadyRan(bp: Blueprint, n: BpNode): boolean {
  if (n.type === "prompt" || n.type === "button" || n.type === "budget") {
    const fed = outgoing(bp, n.id).filter((x) => x.type !== "stub")
    return fed.length > 0 && fed.every((x) => alreadyRan(bp, x))
  }
  return n.status === "done" || n.status === "failed"
}

/** Every node reachable forward from `id` through wires (stubs excluded), not including `id` itself. */
export function downstreamOf(bp: Blueprint, id: string): Set<string> {
  const out = new Set<string>()
  const queue = [id]
  while (queue.length) {
    const cur = queue.shift()!
    for (const n of outgoing(bp, cur)) {
      if (n.type === "stub" || out.has(n.id) || n.id === id) continue
      out.add(n.id)
      queue.push(n.id)
    }
  }
  return out
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
  // Pass-through boxes (snapshot, check, verify, queue, button) and upstream AIs: the project an AI wired behind them
  // works on is the build those boxes sit on. 2026-10-01: a Dikiş wired Bölücü → snapshot → Dikiş got no folder and
  // ran in a fresh empty build.
  const passThrough = new Set<BpNodeType>(["snapshot", "check", "verify", "queue", "button", "budget", "model"])
  const inherited = (id: string, seen = new Set<string>(), depth = 0): BpNode[] => {
    if (seen.has(id) || depth > 6) return []
    seen.add(id)
    const out: BpNode[] = []
    for (const n of incoming(bp, id)) {
      if (isBuild(n)) out.push(n)
      else if (passThrough.has(n.type)) out.push(...inherited(n.id, seen, depth + 1))
      else if (n.type === "ai") out.push(...outgoing(bp, n.id).filter(isBuild), ...inherited(n.id, seen, depth + 1))
    }
    return out
  }
  const viaChain = builds.length || viaPrompt.length || viaButton.length ? [] : inherited(aiId)
  const folders = Array.from(new Set([...builds, ...viaPrompt, ...viaButton, ...viaChain].map((b) => (b.data.type === "build" || b.data.type === "buildPhoto" ? b.data.folderPath : "")).filter(Boolean)))
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
      const fedByReport = n.data.type === "ai" && (n.data.role === "dikis" || incoming(bp, n.id).some((x) => x.type === "check" || x.type === "verify" || x.type === "model"))
      if (!fedByBilinc && !fedByReport && !incoming(bp, n.id).some((x) => x.type === "prompt" || x.type === "wizard")) add(n.id, "ai.noPrompt")
      if (!n.data.type || (n.data.type === "ai" && !n.data.modelRef && !n.data.pool?.length)) add(n.id, "ai.noModel")
      if (n.data.type === "ai" && (n.data.repos ?? []).some((r) => r.url.trim() && !isRepoUrl(r.url))) add(n.id, "ai.badRepo")
      if (n.data.type === "ai" && n.data.role === "eylem" && !incoming(bp, n.id).some((x) => x.data.type === "ai" && x.data.role === "bilinc")) add(n.id, "eylem.noBilinc")
      if (n.data.type === "ai" && n.data.role === "bilinc" && !outgoing(bp, n.id).some((x) => x.data.type === "ai" && x.data.role === "eylem")) add(n.id, "bilinc.noEylem")
      if (n.data.type === "ai" && n.data.role === "donusturucu" && !incoming(bp, n.id).some((x) => x.type === "build" || x.type === "buildPhoto" || x.type === "stub" || x.type === "ai")) add(n.id, "donusturucu.noSource")
      if (n.data.type === "ai" && n.data.role === "kesifci" && !outgoing(bp, n.id).some((x) => x.type === "ai")) add(n.id, "kesifci.noNext")
    }
    if (n.type === "check" && !incoming(bp, n.id).some((x) => x.type === "build" || x.type === "buildPhoto" || x.type === "ai")) add(n.id, "check.noSource")
    if (n.type === "ai" && n.data.type === "ai" && n.data.role === "dikis" && !incoming(bp, n.id).some((x) => x.type === "build" || x.type === "buildPhoto" || x.type === "ai" || x.type === "verify" || x.type === "snapshot" || x.type === "queue" || x.type === "check")) add(n.id, "dikis.noSource")
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
    if (n.type === "model") {
      if (!incoming(bp, n.id).some((x) => x.type === "build" || x.type === "buildPhoto" || x.type === "ai")) add(n.id, "model.noSource")
      if (n.data.type === "model" && !n.data.modelRef) add(n.id, "model.noModel")
      if (!outgoing(bp, n.id).some((x) => x.type === "ai")) add(n.id, "model.noTarget")
    }
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
  fix?: { problem: string; files: string[]; run?: boolean }
  /** `silent bp deliver …`: files handed to a Model Plus box (absolute paths) and an optional request name. */
  deliver?: { paths: string[]; for?: string }
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
