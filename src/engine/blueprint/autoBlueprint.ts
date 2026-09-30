import { isRepoUrl } from "./prompt"
import type { Blueprint, BpEdge, BpNode, BpNodeData, BpNodeType, CostMode, ProviderModel } from "@/domain"
import { BP_STUB_KINDS, canConnect, modelRef } from "@/domain"
import type { BpStubKind } from "@/domain"
import type { ExpertKit } from "@/domain/kits"
import { newId } from "@/lib/ids"
import { providerInfo } from "@/providers/registry"
import { modelStrengths, pickPlannerModel } from "@/engine/aiPlanner"
import type { CliRunRequest, RuntimeEvent } from "@/domain"

/** `silent bp auto "<goal>"` / "AI ile oluştur": a planner-capable CLI designs the whole graph. */

export const AUTO_BLUEPRINT_TIMEOUT_SECS = 240

const NODE_TYPES: BpNodeType[] = ["prompt", "ai", "build", "buildPhoto", "button", "variable", "wizard", "stub", "check"]

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
          instructions: { type: "string", description: "ai: base instructions prepended to every run (persona, standing rules)" },
          role: { type: "string", enum: ["bilinc", "eylem", "donusturucu", "kesifci"], description: "ai: bilinc = read-only investigator that writes a report; eylem = applies the wired bilinc reports; donusturucu = converts wired assets (images/audio) into the format the next AI needs; kesifci = cheap read-only scout whose RECON report the next AI works from" },
          effort: { type: "string", enum: ["low", "medium", "high", "xhigh"], description: "ai: reasoning effort the run starts with (omit for Silent's per-task policy)" },
          repos: { type: "array", items: { type: "string" }, description: "ai: GitHub repository urls (https:// or git@) cloned into .silent/refs before every run" },
          modelRef: { type: "string", description: "ai/wizard: provider:model from the catalog" },
          pool: { type: "array", items: { type: "string" }, description: "ai (orchestration): extra provider:model refs the planner may assign" },
          mode: { type: "string", enum: ["orchestration", "single"] },
          costMode: { type: "string", enum: ["economy", "balanced", "max-quality"] },
          kitId: { type: "string" },
          kind: { type: "string", enum: ["start", "send", "reload", "parallel"], description: "button only" },
          filter: { type: "string", description: "variable only: glob such as *.png" },
          kinds: { type: "array", items: { type: "string", enum: ["image", "sprite", "tileset", "sfx", "music", "voice", "text", "font", "model3d", "video"] }, description: "stub only" },
          folder: { type: "string", description: "stub only: placeholder folder relative to the build" },
          commands: { type: "array", items: { type: "string" }, description: "check only: shell commands run in the wired folder without a model (empty = typecheck, test, build)" },
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
  instructions?: string
  repos?: string[]
  role?: "bilinc" | "eylem" | "donusturucu" | "kesifci"
  effort?: "low" | "medium" | "high" | "xhigh"
  modelRef?: string
  pool?: string[]
  mode?: "orchestration" | "single"
  costMode?: CostMode
  kitId?: string
  kind?: "start" | "send" | "reload" | "parallel"
  filter?: string
  kinds?: string[]
  folder?: string
  commands?: string[]
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
  /** "AI ile düzenle": the blueprint to modify (node ids become keys so kept nodes survive); absent = design a new one. */
  existing?: Blueprint
}

/** Compact JSON of an existing blueprint for the designer. */
export function describeExisting(bp: Blueprint): string {
  const nodes = bp.nodes.map((n) => {
    const d = n.data as unknown as Record<string, unknown>
    const pick = (k: string) => (d[k] === undefined || d[k] === "" ? undefined : d[k])
    return {
      key: n.id,
      type: n.type,
      title: pick("title"),
      text: typeof d.text === "string" ? (d.text as string).slice(0, 300) : undefined,
      modelRef: pick("modelRef"),
      pool: pick("pool"),
      mode: pick("mode"),
      role: pick("role"),
      effort: pick("effort"),
      kind: pick("kind"),
      kinds: pick("kinds"),
      folder: pick("folder"),
      commands: pick("commands"),
      instructions: typeof d.instructions === "string" ? (d.instructions as string).slice(0, 200) : undefined,
      repos: Array.isArray(d.repos) ? (d.repos as Array<{ url: string }>).map((r) => r.url) : undefined,
    }
  })
  return JSON.stringify({ name: bp.name, nodes, edges: bp.edges.map((e) => ({ from: e.from, to: e.to })) })
}

const RULES = `Node types and what they do:
- prompt: a brief (title + text). Wire into an AI. Write the text IN ENGLISH, detailed and production-grade (goal, features, quality bar, verification), titles in the user's language.
- ai: a run. mode "orchestration" = Silent's planner splits the brief into tasks executed in parallel by workers + a polish round (use for building things); mode "single" = one CLI session (cheap follow-ups, integrations). modelRef = main model; pool = additional models the planner may assign per task (orchestration only). The planner picks a planner-capable model from the pool, so an orchestration pool MUST contain a planner-capable model.
- ai with repos ("Özel AI"): set repos to GitHub urls and put the persona/standing rules in instructions; Silent clones the repos into .silent/refs before every run and lists their paths in the brief. Use it for mods, ports and "learn from this codebase" tasks; the wired prompt stays the task.
- Asset branches never dead-end: when a parallel art/audio branch produces files after the main build, ALWAYS wire its output (Build/buildPhoto) into a donusturucu ai and then into a single-mode integration ai ("Entegrasyon AI", wired from the Build) whose prompt says to load the produced assets into the code; a review (bilinc → eylem) does not replace that integration step.
- ai role donusturucu (asset converter): when an art/audio producer (an art AI, a buildPhoto, a placeholder filler, or files the user drops in) feeds a consumer AI that needs a specific format (transparent PNG frames, sprite sheet + atlas, 16-bit WAV), put a single-mode donusturucu ai on a cheap model between them; its purpose names the target format; wire the source (Build/buildPhoto/AI) into it and it into the consumer.
- ai role bilinc/eylem (cost saver for investigation): a bilinc ai runs READ-ONLY (expensive model, e.g. Claude) and writes a FINDINGS/ACTIONS report; wire it into an eylem ai (cheap model, single mode, wired to the same Build) which applies the report. Shape: Build → prompt → bilinc → eylem → Build. Use for bug hunts, audits, reviews.
- build: the real project folder the AI writes into. One Build per project; an AI wired into it develops that folder. Wire Build → prompt → ai for follow-up stages on the same project.
- buildPhoto: collects images produced by the wired AI (and workers' screenshots).
- button start: runs the chain forward, one AI after another. button parallel ("Paralel"): every prompt/AI wired after it starts AT THE SAME TIME and the chain continues only when all are done — wire Build → parallel → the independent role prompts (audio, models, textures, text) so they do not queue. button reload: re-runs the wired AI with its purpose (e.g. regenerate broken art). button send: copies files between builds.
- variable: watches a build/photo folder (glob filter) and fires the wired wizard/ai when files change.
- wizard: a small AI that turns a variable event into a short instruction for the wired AI.
- check ("Denetçi", zero tokens): runs the project's own commands (typecheck, tests, build; field commands, empty = defaults) in the wired folder WITHOUT a model; when green the chain simply ends there, when red its report becomes the work order of the ai wired after it (a cheap single-mode fixer, role eylem). Wire ai → check → ai after every build stage instead of asking a model to verify.
- ai role kesifci ("Keşifçi", cost saver): a cheap read-only scout (fast model, single mode) that writes a RECON report of exactly which files/lines the next AI must touch; wire prompt → kesifci ai → expensive ai so the expensive model edits instead of re-scanning the repository.
- stub ("Uydurma", cost saver): wired stub → ai, that AI registers prompt-named PLACEHOLDERS instead of producing real assets (kinds: image, sprite, tileset, sfx, music, voice, text, font, model3d, video; fields kinds and folder, folder default assets/uydurma); wired ai → stub, that AI later fills the placeholders from the manifest prompts (use an image-tool model for images). Use it whenever an expensive model would otherwise draw or synthesise.
Wiring rules (from → to): prompt→ai|wizard; ai→build|buildPhoto|ai|stub|check; build|buildPhoto→prompt|button|ai|variable|check; button→ai|build|buildPhoto|prompt; variable→wizard|ai; wizard→ai; stub→ai; check→ai.
Model rules: use only refs from the catalog below; art/drawing tasks need a model whose strengths say it can GENERATE RASTER IMAGES; browser verification needs a model that can drive a browser; big builds → max-quality with a frontier planner-capable model; cheap follow-ups → single mode.
Shape: Start → main prompt → main AI (orchestration) → Build (+ buildPhoto when art is involved; EVERY buildPhoto needs an incoming wire from the AI that produces the images, e.g. the art AI → buildPhoto); then Build → a parallel button → follow-up prompts → independent role AIs (visuals, audio, art, text) each wired back into the same Build, and Build → integration prompt → integrator AI (runs after the fan-out); add a Reload button for the art AI when images are generated; optionally buildPhoto → variable → wizard → a CHEAP single-mode integrator ai (never the main orchestration AI: a wizard fires on every new file). Keep it 5–14 nodes. Titles in the user's language; assign the models the user names to the roles they name.`

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
    ...(ctx.existing
      ? [
          `EXISTING BLUEPRINT (modify it, do not start over): return the FULL updated graph. Keep the exact "key" of every node you keep (its run history depends on it) and change only what the request asks; add, remove or rewire nodes as needed. Texts are truncated to 300 characters here: when you keep a node's text, reuse its key and repeat the truncated text as is.\n${describeExisting(ctx.existing)}`,
        ]
      : []),
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

/** Layered layout: first-visit BFS depth → column, order within the column → row. Back-edges (Build → prompt → AI → Build) never push a node further right. */
export function layoutAutoBlueprint(nodes: AutoBlueprintNode[], edges: Array<{ from: string; to: string }>): Map<string, { x: number; y: number }> {
  const incoming = new Map<string, number>()
  for (const n of nodes) incoming.set(n.key, 0)
  for (const e of edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1)
  const depth = new Map<string, number>()
  const roots = nodes.filter((n) => (incoming.get(n.key) ?? 0) === 0).map((n) => n.key)
  const queue = roots.length ? roots : nodes.slice(0, 1).map((n) => n.key)
  for (const k of queue) depth.set(k, 0)
  while (queue.length) {
    const k = queue.shift()!
    for (const e of edges.filter((e) => e.from === k)) {
      if (depth.has(e.to)) continue
      depth.set(e.to, (depth.get(k) ?? 0) + 1)
      queue.push(e.to)
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
export function materializeAutoBlueprint(result: AutoBlueprintResult, models: ProviderModel[], existing?: Blueprint): MaterializedBlueprint {
  const warnings: string[] = []
  const keep = new Map((existing?.nodes ?? []).map((n) => [n.id, n]))
  const known = new Set(models.map((m) => modelRef(m.providerId, m.id)))
  const planner = pickPlannerModel(models)
  const fallbackRef = planner ? modelRef(planner.providerId, planner.id) : (models[0] ? modelRef(models[0].providerId, models[0].id) : "")
  const fixRef = (ref: string | undefined, key: string): string => {
    if (ref && known.has(ref)) return ref
    if (ref) warnings.push(`${key}: unknown model ${ref} → ${fallbackRef}`)
    return fallbackRef
  }
  const positions = layoutAutoBlueprint(result.nodes, result.edges)
  const ids = new Map(result.nodes.map((n) => [n.key, keep.has(n.key) ? n.key : newId("n")]))
  for (const old of keep.values()) if (!ids.has(old.id)) warnings.push(`${old.id}: removed by the designer`)
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
        const repos = (n.repos ?? []).filter(isRepoUrl).map((url) => ({ url }))
        data = { type: "ai", title: n.title, modelRef: main, pool: pool.length > 1 ? pool : undefined, mode, costMode: n.costMode, kitId: n.kitId, purpose: n.purpose, instructions: n.instructions?.trim() || undefined, repos: repos.length ? repos : undefined, role: n.role === "bilinc" || n.role === "eylem" || n.role === "donusturucu" || n.role === "kesifci" ? n.role : undefined, effort: n.effort }
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
      case "check":
        data = { type: "check", title: n.title, commands: (n.commands ?? []).filter((c): c is string => typeof c === "string" && c.trim().length > 0), maxLines: 40, timeoutSecs: 900 }
        break
      case "stub":
        data = { type: "stub", title: n.title, kinds: (n.kinds ?? []).filter((k): k is BpStubKind => (BP_STUB_KINDS as string[]).includes(k)), folder: n.folder || "assets/uydurma" }
        break
    }
    const prev = keep.get(n.key)
    if (prev && prev.type === n.type) {
      // Kept node: same id, position and run history; the designer's fields replace only what it set. A kept
      // prompt whose text came back truncated keeps its full original text.
      const fresh = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== ""))
      if (prev.data.type === "prompt" && data.type === "prompt" && prev.data.text.startsWith(data.text.trim())) delete fresh.text
      return { ...prev, data: { ...prev.data, ...fresh } as BpNodeData }
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
  // A photo build with no producing AI never fills: wire the image-capable AI (else the main orchestration AI) into it.
  for (const photo of nodes.filter((n) => n.type === "buildPhoto")) {
    if (edges.some((e) => e.to === photo.id && nodes.find((n) => n.id === e.from)?.type === "ai")) continue
    const ais = nodes.filter((n) => n.data.type === "ai")
    const painter = ais.find((n) => n.data.type === "ai" && [n.data.modelRef, ...(n.data.pool ?? [])].some((ref) => providerInfo(ref.split(":")[0] as ProviderModel["providerId"]).capabilities.image))
    const source = painter ?? ais.find((n) => n.data.type === "ai" && n.data.mode === "orchestration") ?? ais[0]
    if (source) {
      edges.push({ id: newId("e"), from: source.id, to: photo.id })
      warnings.push(`wired ${source.data.type === "ai" ? source.data.title : source.id} → ${photo.data.type === "buildPhoto" ? photo.data.title : photo.id} (photo build had no producing AI)`)
    }
  }
  if (!nodes.some((n) => n.data.type === "button" && n.data.kind === "start")) {
    // Always give the user a Start: wire it into the first prompt.
    const firstPrompt = nodes.find((n) => n.type === "prompt")
    const start: BpNode = { id: newId("n"), type: "button", x: 40, y: (firstPrompt?.y ?? 40) + 60, data: { type: "button", kind: "start" } }
    // Make room for the injected Start; nodes kept from an existing blueprint stay where the user put them.
    for (const n of nodes) if (!keep.has(n.id)) n.x += 260
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
