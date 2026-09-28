import type { Blueprint, BpEdge, BpNode, BpNodeData, BpNodeType, CostMode, ProviderModel } from "@/domain"
import { canConnect, modelRef } from "@/domain"
import type { ExpertKit } from "@/domain/kits"
import { newId } from "@/lib/ids"
import { providerInfo } from "@/providers/registry"
import { modelStrengths, pickPlannerModel } from "@/engine/aiPlanner"
import type { CliRunRequest, RuntimeEvent } from "@/domain"

/** `silent bp auto "<goal>"` / "AI ile oluştur": a planner-capable CLI designs the whole graph. */

export const AUTO_BLUEPRINT_TIMEOUT_SECS = 240

const NODE_TYPES: BpNodeType[] = ["prompt", "ai", "build", "buildPhoto", "button", "variable", "wizard"]

/** Structured output the CLI must return (Gemini-compatible: string enums only). */
export const AUTO_BLUEPRINT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["name", "summary", "nodes", "edges"],
  properties: {
    name: { type: "string", description: "Short blueprint name in the user's language" },
    summary: { type: "string", description: "One paragraph, user's language: what the chain does and why the models were chosen" },
    nodes: {
      type: "array",
      minItems: 3,
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "type", "title"],
        properties: {
          key: { type: "string" },
          type: { type: "string", enum: NODE_TYPES },
          title: { type: "string" },
          text: { type: "string", description: "prompt: the full brief in ENGLISH" },
          purpose: { type: "string", description: "ai/wizard: purpose used by Reload and wizards" },
          modelRef: { type: "string", description: "ai/wizard: provider:model from the catalog" },
          pool: { type: "array", items: { type: "string" }, description: "ai (orchestration): extra provider:model refs the planner may assign" },
          mode: { type: "string", enum: ["orchestration", "single"] },
          costMode: { type: "string", enum: ["economy", "balanced", "max-quality"] },
          kitId: { type: "string" },
          kind: { type: "string", enum: ["start", "send", "reload"], description: "button only" },
          filter: { type: "string", description: "variable only: glob such as *.png" },
        },
      },
    },
    edges: { type: "array", items: { type: "object", additionalProperties: false, required: ["from", "to"], properties: { from: { type: "string" }, to: { type: "string" } } } },
  },
}

export interface AutoBlueprintNode {
  key: string
  type: BpNodeType
  title: string
  text?: string
  purpose?: string
  modelRef?: string
  pool?: string[]
  mode?: "orchestration" | "single"
  costMode?: CostMode
  kitId?: string
  kind?: "start" | "send" | "reload"
  filter?: string
}
export interface AutoBlueprintResult {
  name: string
  summary: string
  nodes: AutoBlueprintNode[]
  edges: Array<{ from: string; to: string }>
}

export interface AutoBlueprintContext {
  request: string
  language: "tr" | "en"
  models: ProviderModel[]
  kits: ExpertKit[]
}

const RULES = `Node types and what they do:
- prompt: a brief (title + text). Wire into an AI. Write the text IN ENGLISH, detailed and production-grade (goal, features, quality bar, verification), titles in the user's language.
- ai: a run. mode "orchestration" = Silent's planner splits the brief into tasks executed in parallel by workers + a polish round (use for building things); mode "single" = one CLI session (cheap follow-ups, integrations). modelRef = main model; pool = additional models the planner may assign per task (orchestration only). The planner picks a planner-capable model from the pool, so an orchestration pool MUST contain a planner-capable model.
- build: the real project folder the AI writes into. One Build per project; an AI wired into it develops that folder. Wire Build → prompt → ai for follow-up stages on the same project.
- buildPhoto: collects images produced by the wired AI (and workers' screenshots).
- button start: runs the chain forward. button reload: re-runs the wired AI with its purpose (e.g. regenerate broken art). button send: copies files between builds.
- variable: watches a build/photo folder (glob filter) and fires the wired wizard/ai when files change.
- wizard: a small AI that turns a variable event into a short instruction for the wired AI.
Wiring rules (from → to): prompt→ai|wizard; ai→build|buildPhoto|ai; build|buildPhoto→prompt|button|ai|variable; button→ai|build|buildPhoto|prompt; variable→wizard|ai; wizard→ai.
Model rules: use only refs from the catalog below; art/drawing tasks need a model whose strengths say it can GENERATE RASTER IMAGES; browser verification needs a model that can drive a browser; big builds → max-quality with a frontier planner-capable model; cheap follow-ups → single mode.
Shape: Start → main prompt → main AI (orchestration) → Build (+ buildPhoto when art is involved); then Build → follow-up prompts → role AIs (visuals, audio, art, integration) each wired back into the same Build; add a Reload button for the art AI when images are generated; optionally buildPhoto → variable → wizard → integrator ai. Keep it 5–14 nodes. Titles in the user's language; assign the models the user names to the roles they name.`

export function buildAutoBlueprintPrompt(ctx: AutoBlueprintContext): string {
  const catalog = ctx.models
    .map((m) => {
      const caps = providerInfo(m.providerId).capabilities
      const flags = [caps.planner ? "planner-capable" : "", caps.browser ? "browser" : "", caps.image ? "image tool" : ""].filter(Boolean).join(", ")
      return `- ${modelRef(m.providerId, m.id)} (${m.tier}${flags ? `; ${flags}` : ""}): ${modelStrengths(m)}`
    })
    .join("\n")
  const kits = ctx.kits.map((k) => `- ${k.id}: ${k.name.en}`).join("\n")
  return [
    "You design a Silent Blueprint: a node graph where AI CLIs build a project through wired boxes. Return ONLY the JSON object required by the schema.",
    RULES,
    `Model catalog (installed CLIs):\n${catalog}`,
    `Expert kits (kitId for AI nodes; reference repos are cloned for workers):\n${kits}`,
    `User's language: ${ctx.language === "tr" ? "Turkish" : "English"}.`,
    `User request:\n${ctx.request}`,
  ].join("\n\n")
}

export function parseAutoBlueprint(text: string): AutoBlueprintResult | null {
  const candidates = [text.trim()]
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1))
  for (const c of candidates) {
    try {
      const v = JSON.parse(c) as Partial<AutoBlueprintResult>
      if (!v || !Array.isArray(v.nodes) || !Array.isArray(v.edges)) continue
      const nodes = v.nodes
        .filter((n): n is AutoBlueprintNode => Boolean(n) && typeof n.key === "string" && NODE_TYPES.includes(n.type as BpNodeType))
        .map((n) => ({ ...n, title: typeof n.title === "string" ? n.title : n.key }))
      if (!nodes.length) continue
      const keys = new Set(nodes.map((n) => n.key))
      const edges = v.edges.filter((e) => e && typeof e.from === "string" && typeof e.to === "string" && keys.has(e.from) && keys.has(e.to))
      return { name: typeof v.name === "string" && v.name.trim() ? v.name.trim() : "Blueprint", summary: typeof v.summary === "string" ? v.summary : "", nodes, edges }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/** Layered layout: BFS depth → column, order within the column → row. */
export function layoutAutoBlueprint(nodes: AutoBlueprintNode[], edges: Array<{ from: string; to: string }>): Map<string, { x: number; y: number }> {
  const incoming = new Map<string, number>()
  for (const n of nodes) incoming.set(n.key, 0)
  for (const e of edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1)
  const depth = new Map<string, number>()
  const queue = nodes.filter((n) => (incoming.get(n.key) ?? 0) === 0).map((n) => n.key)
  for (const k of queue) depth.set(k, 0)
  while (queue.length) {
    const k = queue.shift()!
    for (const e of edges.filter((e) => e.from === k)) {
      const d = (depth.get(k) ?? 0) + 1
      if ((depth.get(e.to) ?? -1) < d && d < 20) {
        depth.set(e.to, d)
        queue.push(e.to)
      }
    }
  }
  for (const n of nodes) if (!depth.has(n.key)) depth.set(n.key, 0)
  const rows = new Map<number, number>()
  const out = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    const d = depth.get(n.key) ?? 0
    const row = rows.get(d) ?? 0
    rows.set(d, row + 1)
    out.set(n.key, { x: 40 + d * 300, y: 40 + row * 200 })
  }
  return out
}

export interface MaterializedBlueprint {
  nodes: BpNode[]
  edges: BpEdge[]
  warnings: string[]
}

/** Turn the CLI's answer into real nodes/edges: keys → ids, illegal wires dropped, unknown models replaced. */
export function materializeAutoBlueprint(result: AutoBlueprintResult, models: ProviderModel[]): MaterializedBlueprint {
  const warnings: string[] = []
  const known = new Set(models.map((m) => modelRef(m.providerId, m.id)))
  const planner = pickPlannerModel(models)
  const fallbackRef = planner ? modelRef(planner.providerId, planner.id) : (models[0] ? modelRef(models[0].providerId, models[0].id) : "")
  const fixRef = (ref: string | undefined, key: string): string => {
    if (ref && known.has(ref)) return ref
    if (ref) warnings.push(`${key}: unknown model ${ref} → ${fallbackRef}`)
    return fallbackRef
  }
  const positions = layoutAutoBlueprint(result.nodes, result.edges)
  const ids = new Map(result.nodes.map((n) => [n.key, newId("n")]))
  const nodes: BpNode[] = result.nodes.map((n) => {
    const pos = positions.get(n.key) ?? { x: 40, y: 40 }
    let data: BpNodeData
    switch (n.type) {
      case "prompt":
        data = { type: "prompt", title: n.title, text: n.text ?? "" }
        break
      case "ai": {
        const main = fixRef(n.modelRef, n.key)
        const pool = Array.from(new Set([main, ...(n.pool ?? []).filter((p) => known.has(p))]))
        const mode = n.mode === "single" ? "single" : "orchestration"
        if (mode === "orchestration" && !pool.some((p) => providerInfo(p.split(":")[0] as ProviderModel["providerId"]).capabilities.planner) && fallbackRef) {
          pool.push(fallbackRef)
          warnings.push(`${n.key}: added ${fallbackRef} so the pool can plan`)
        }
        data = { type: "ai", title: n.title, modelRef: main, pool: pool.length > 1 ? pool : undefined, mode, costMode: n.costMode, kitId: n.kitId, purpose: n.purpose }
        break
      }
      case "wizard":
        data = { type: "wizard", title: n.title, modelRef: fixRef(n.modelRef, n.key), purpose: n.purpose ?? n.text ?? "" }
        break
      case "build":
        data = { type: "build", title: n.title, folderPath: "", kind: "code" }
        break
      case "buildPhoto":
        data = { type: "buildPhoto", title: n.title, folderPath: "", kind: "photo" }
        break
      case "button":
        data = { type: "button", kind: n.kind ?? "start" }
        break
      case "variable":
        data = { type: "variable", filter: n.filter || "*.png" }
        break
    }
    return { id: ids.get(n.key)!, type: n.type, x: pos.x, y: pos.y, data }
  })
  const typeOf = new Map(result.nodes.map((n) => [n.key, n.type]))
  const seen = new Set<string>()
  const edges: BpEdge[] = []
  for (const e of result.edges) {
    const from = typeOf.get(e.from)
    const to = typeOf.get(e.to)
    if (!from || !to || e.from === e.to) continue
    if (!canConnect(from, to)) {
      warnings.push(`dropped illegal wire ${from} → ${to} (${e.from} → ${e.to})`)
      continue
    }
    const sig = `${e.from}>${e.to}`
    if (seen.has(sig)) continue
    seen.add(sig)
    edges.push({ id: newId("e"), from: ids.get(e.from)!, to: ids.get(e.to)! })
  }
  if (!nodes.some((n) => n.data.type === "button" && n.data.kind === "start")) {
    // Always give the user a Start: wire it into the first prompt.
    const firstPrompt = nodes.find((n) => n.type === "prompt")
    const start: BpNode = { id: newId("n"), type: "button", x: 40, y: (firstPrompt?.y ?? 40) + 60, data: { type: "button", kind: "start" } }
    for (const n of nodes) n.x += 260
    nodes.unshift(start)
    if (firstPrompt) edges.unshift({ id: newId("e"), from: start.id, to: firstPrompt.id })
  }
  return { nodes, edges, warnings }
}

export interface AutoBlueprintRunner {
  cliStart(request: CliRunRequest, onEvent: (event: RuntimeEvent) => void): Promise<{ cancel(): Promise<void> }>
}

/** Ask a planner-capable CLI (Claude preferred) to design the graph. Throws when no valid JSON comes back. */
export async function requestAutoBlueprint(runner: AutoBlueprintRunner, ctx: AutoBlueprintContext, model: ProviderModel, onLog?: (line: string) => void): Promise<{ result: AutoBlueprintResult; raw: string }> {
  let raw = ""
  let failed: string | undefined
  await new Promise<void>((resolve) => {
    void runner
      .cliStart(
        {
          runId: `bpauto:${newId("a")}`,
          providerId: model.providerId,
          modelId: model.id,
          prompt: buildAutoBlueprintPrompt(ctx),
          sandbox: "read-only",
          ephemeral: true,
          effort: "medium",
          timeoutSecs: AUTO_BLUEPRINT_TIMEOUT_SECS,
          outputSchema: AUTO_BLUEPRINT_SCHEMA,
        },
        (e) => {
          if (e.type === "agentMessage") raw = e.data.text
          else if (e.type === "stderr") onLog?.(e.data.line)
          else if (e.type === "failed" && e.data.code !== "cancelled") failed = e.data.message
          else if (e.type === "exited") resolve()
        },
      )
      .catch((err: unknown) => {
        failed = err instanceof Error ? err.message : String(err)
        resolve()
      })
  })
  if (failed && !raw) throw new Error(failed)
  const result = parseAutoBlueprint(raw)
  if (!result) throw new Error("no valid blueprint JSON")
  return { result, raw }
}

/** Claude first (the connected terminal), then any other planner-capable model. */
export function pickAutoBlueprintModel(models: ProviderModel[]): ProviderModel | undefined {
  const claude = models.filter((m) => m.providerId === "claude" && providerInfo(m.providerId).capabilities.planner)
  return pickPlannerModel(claude.length ? claude : models) ?? pickPlannerModel(models)
}

export function blueprintFromAuto(name: string, materialized: MaterializedBlueprint): Blueprint {
  const now = Date.now()
  return { id: newId("bp"), name, nodes: materialized.nodes, edges: materialized.edges, createdAt: now, updatedAt: now }
}
