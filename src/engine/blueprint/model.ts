/**
 * Model Plus (2026-10-05): the asset contract box. Pure helpers — the store (`execModel`, deliveries) does the IO.
 *
 * One request = one subject = one packed sheet the user generates with an external image AI. Frames land under
 * `<target>/` as `<name>_<anim>_<NN>.png` plus `<name>.png` + `<name>.json` (the converter tool's `pack` atlas), which
 * the Dosyalar tab (`groupAtlasFrames`, `AtlasAnimPreview`) already understands.
 */
import type { ModelRequest, ModelRequestKind } from "@/domain"
import { DONUSTURUCU_POLICY } from "./prompt"

export const MODEL_REQUESTS_HEADING = "# MODEL_REQUESTS"
export const MODEL_DELIVERY_HEADING = "# MODEL_DELIVERY"
export const MODEL_REPORT_HEADING = "# MODEL"
/** Where the box mirrors its requests inside the build (restart-safe, readable by scripts). */
export const MODEL_STATE_REL = ".silent/model-plus/requests.json"
/** Human manifest written next to the code once every request is accepted. */
export const MODEL_DOC_REL = "MODEL-PLUS.md"
export const MODEL_DEFAULT_FOLDER = "assets/model-plus"

const KINDS: ModelRequestKind[] = ["sprite-sheet", "texture", "tileset", "image", "model3d", "audio"]
const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" }

/** `Mario Kardeş` → `mario_kardes`: lowercase ascii, underscores, no leading/trailing underscore. */
export function slugName(s: string): string {
  const lower = s
    .toLowerCase()
    .split("")
    .map((ch) => TR_MAP[ch] ?? ch)
    .join("")
  return lower.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)
}

function asInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function normalizeKind(v: unknown, hint: Record<string, unknown>): ModelRequestKind | undefined {
  const raw = typeof v === "string" ? v.toLowerCase().replace(/[\s_]+/g, "-") : ""
  if ((KINDS as string[]).includes(raw)) return raw as ModelRequestKind
  if (/sprite|sheet|anim|character|mob|enemy|player/.test(raw)) return "sprite-sheet"
  if (/tile/.test(raw)) return "tileset"
  if (/tex|skin|material/.test(raw)) return "texture"
  if (/sound|sfx|music|audio|voice|wav|ogg|mp3/.test(raw)) return "audio"
  if (/3d|model|mesh|glb|obj|voxel/.test(raw)) return "model3d"
  if (/image|background|bg|icon|ui|portrait|logo|png/.test(raw)) return "image"
  if (Array.isArray(hint.animations) && hint.animations.length) return "sprite-sheet"
  return undefined
}

function parseFrameSize(v: unknown): string | undefined {
  if (typeof v === "string") {
    const m = v.trim().toLowerCase().match(/^(\d+)\s*[x×]\s*(\d+)$/)
    if (m) return `${m[1]}x${m[2]}`
  }
  if (typeof v === "number" && v > 0) return `${Math.floor(v)}x${Math.floor(v)}`
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    const w = asInt(o.w ?? o.width, 0)
    const h = asInt(o.h ?? o.height, 0)
    if (w && h) return `${w}x${h}`
  }
  return undefined
}

export function frameSizeOf(req: Pick<ModelRequest, "frameSize">): { w: number; h: number } | undefined {
  const m = req.frameSize?.match(/^(\d+)x(\d+)$/)
  return m ? { w: Number(m[1]), h: Number(m[2]) } : undefined
}

/** Frames a request asks for in total (0 for kinds without animations). */
export function totalFrames(req: Pick<ModelRequest, "animations">): number {
  return (req.animations ?? []).reduce((n, a) => n + a.frames, 0)
}

/** Extract the JSON array after `# MODEL_REQUESTS` (tolerant: prose around it, code fences, upper/lower case). */
export function parseModelRequests(text: string, opts: { folder: string; style?: string }): ModelRequest[] {
  if (!text) return []
  const upper = text.toUpperCase()
  const at = upper.lastIndexOf(MODEL_REQUESTS_HEADING)
  const tail = at >= 0 ? text.slice(at + MODEL_REQUESTS_HEADING.length) : text
  const start = tail.indexOf("[")
  const end = tail.lastIndexOf("]")
  if (start < 0 || end <= start) return []
  let raw: unknown
  try {
    raw = JSON.parse(tail.slice(start, end + 1).replace(/```(?:json)?/gi, ""))
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: ModelRequest[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const subject = typeof o.subject === "string" && o.subject.trim() ? o.subject.trim() : typeof o.name === "string" ? o.name.trim() : ""
    const name = slugName(typeof o.name === "string" && o.name.trim() ? o.name : subject)
    if (!name || seen.has(name)) continue
    const kind = normalizeKind(o.kind, o)
    if (!kind) continue
    seen.add(name)
    const animations = Array.isArray(o.animations)
      ? o.animations
          .map((a): { name: string; frames: number } | null => {
            if (typeof a === "string") return { name: slugName(a), frames: 1 }
            if (!a || typeof a !== "object") return null
            const ao = a as Record<string, unknown>
            const an = slugName(typeof ao.name === "string" ? ao.name : "")
            return an ? { name: an, frames: asInt(ao.frames ?? ao.count, 1) } : null
          })
          .filter((a): a is { name: string; frames: number } => Boolean(a))
      : []
    const frameSize = parseFrameSize(o.frameSize ?? o.size ?? o.cell)
    const req: ModelRequest = {
      id: `mr_${name}`,
      name,
      kind,
      subject: subject || name,
      animations: animations.length ? animations : undefined,
      frameSize,
      view: typeof o.view === "string" && o.view.trim() ? o.view.trim() : undefined,
      notes: typeof o.notes === "string" && o.notes.trim() ? o.notes.trim() : undefined,
      sheetPrompt: "",
      target: typeof o.target === "string" && o.target.trim() ? o.target.trim().replace(/^\.?\//, "").replace(/\/$/, "") : `${opts.folder}/${name}`,
      codeHook: typeof o.codeHook === "string" && o.codeHook.trim() ? o.codeHook.trim() : undefined,
      status: "pending",
    }
    req.sheetPrompt = typeof o.sheetPrompt === "string" && o.sheetPrompt.trim().length > 40 ? o.sheetPrompt.trim() : buildSheetPrompt(req, opts.style)
    out.push(req)
  }
  return out
}

/** The prompt the user pastes into an external image AI: ONE packed sheet, grid = animations × frames. */
export function buildSheetPrompt(req: ModelRequest, style?: string): string {
  const fs = frameSizeOf(req)
  const anims = req.animations ?? []
  const maxFrames = Math.max(1, ...anims.map((a) => a.frames))
  const cols = Math.min(8, maxFrames)
  const rows = anims.length ? anims.reduce((n, a) => n + Math.ceil(a.frames / cols), 0) : 1
  const cell = fs ? Math.max(fs.w, fs.h) * (Math.max(fs.w, fs.h) <= 64 ? 4 : 2) : 256
  const lines: string[] = []
  if (req.kind === "sprite-sheet" || (req.kind === "tileset" && anims.length)) {
    lines.push(`ONE image: a sprite sheet of "${req.subject}" laid out as a strict grid of ${rows} row(s) × ${cols} column(s); every cell exactly ${cell}×${cell} px, identical size, a uniform thin gap, origin at the top-left, no margins other than the gap.`)
    lines.push(`Rows, in this exact order (frames left to right, one animation per row${maxFrames > cols ? ", an animation longer than the row wraps to the next row" : ""}): ${anims.map((a) => `${a.name} × ${a.frames}`).join("; ")}.`)
    lines.push(`Same character, scale, palette and outline weight in every cell; ${req.view ? `${req.view} view; ` : ""}the subject centred and fully inside its cell; a flat single-colour background (#FF00FF magenta) or transparent — nothing else drawn in the cells, no text, no labels inside cells (a caption strip BELOW each row is fine).`)
    lines.push(`It will be downscaled to ${req.frameSize ?? "the game's frame size"} with nearest-neighbour sampling, so keep shapes readable at that size.`)
  } else if (req.kind === "tileset") {
    lines.push(`ONE image: a tileset of "${req.subject}" as a strict grid of equal ${cell}×${cell} px cells, one tile per cell, a uniform thin gap, flat #FF00FF background where a tile is transparent; seamless edges where tiles repeat.`)
  } else if (req.kind === "texture" || req.kind === "image") {
    lines.push(`ONE image of "${req.subject}"${req.frameSize ? ` at ${req.frameSize} px (or an exact multiple)` : ""}; ${req.kind === "texture" ? "seamless/tileable, " : ""}transparent background where the subject does not cover the canvas.`)
  } else if (req.kind === "model3d") {
    lines.push(`A 3D model of "${req.subject}" exported as GLB (or OBJ+MTL), real-world scale, origin at the feet/base, +Y up, low poly, textures embedded.`)
  } else if (req.kind === "audio") {
    lines.push(`An audio clip for "${req.subject}" (WAV 16-bit 44.1 kHz preferred, else OGG/MP3), trimmed, no silence at the ends, normalised.`)
  }
  if (style) lines.push(`Style: ${style}.`)
  if (req.notes) lines.push(`Notes: ${req.notes}.`)
  return lines.join("\n")
}

/** Files the validator expects under the build root for an accepted request. */
export function expectedFiles(req: ModelRequest): string[] {
  const base = req.target.replace(/\/$/, "")
  const anims = req.animations ?? []
  if (req.kind === "sprite-sheet" || (req.kind === "tileset" && anims.length)) {
    const frames = anims.flatMap((a) => Array.from({ length: a.frames }, (_, i) => `${base}/${frameName(req.name, a.name, i)}.png`))
    return [...frames, `${base}/${req.name}.png`, `${base}/${req.name}.json`]
  }
  if (req.kind === "tileset" || req.kind === "texture" || req.kind === "image") return [`${base}/${req.name}.png`]
  if (req.kind === "audio") return [`${base}/${req.name}.wav`]
  return [`${base}/${req.name}.glb`]
}

export function frameName(name: string, anim: string, index: number): string {
  return `${name}_${anim}_${String(index).padStart(2, "0")}`
}

/** Alternative extensions accepted for the non-image kinds (the first of `expectedFiles` is the canonical one). */
const ALT_EXT: Partial<Record<ModelRequestKind, string[]>> = { audio: ["wav", "ogg", "mp3"], model3d: ["glb", "gltf", "obj", "fbx"] }

export interface AtlasJson {
  frameW: number
  frameH: number
  columns?: number
  frames: Array<{ name: string; x: number; y: number; w: number; h: number }>
}

export interface PngProbe {
  width: number
  height: number
  colorType: number
  hasAlpha: boolean
}

/** PNG header probe: signature, IHDR (width, height, colour type) and a tRNS chunk scan; null when not a PNG. */
export function probePng(bytes: Uint8Array): PngProbe | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== "IHDR") return null
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const colorType = bytes[25]!
  let hasAlpha = colorType === 4 || colorType === 6
  // Chunk walk for tRNS (palette or key-colour transparency); tolerate a truncated file.
  let off = 8
  while (!hasAlpha && off + 8 <= bytes.length) {
    const len = view.getUint32(off)
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!)
    if (type === "tRNS") hasAlpha = true
    if (type === "IDAT" || type === "IEND") break
    off += 12 + len
  }
  return { width, height, colorType, hasAlpha }
}

export function decodeBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Which request a delivered file belongs to: `--for`, else the longest request name inside the file name, else the first open one. */
export function matchDelivery(requests: ModelRequest[], filename: string, forName?: string): ModelRequest | undefined {
  if (forName) {
    const want = slugName(forName)
    return requests.find((r) => r.name === want || r.id === forName || slugName(r.subject) === want)
  }
  const slug = slugName(filename.replace(/\.[a-z0-9]+$/i, ""))
  const open = requests.filter((r) => r.status !== "accepted")
  const byName = open.filter((r) => slug.includes(r.name)).sort((a, b) => b.name.length - a.name.length)[0]
  return byName ?? open.find((r) => r.status === "pending") ?? open.find((r) => r.status === "rejected")
}

export interface ValidateIo {
  /** Every file in the build, as relative paths (forward slashes). */
  files: Set<string>
  /** Parsed `<target>/<name>.json`, null when missing or unparsable. */
  atlas: AtlasJson | null
  /** PNG probes keyed by relative path (only the paths the store pre-read). */
  png: Map<string, PngProbe | null>
}

/** The deterministic gate: the spec is the contract, the disk is the evidence. */
export function validateDelivery(req: ModelRequest, io: ValidateIo): { ok: boolean; reasons: string[]; warnings: string[] } {
  const reasons: string[] = []
  const warnings: string[] = []
  const base = req.target.replace(/\/$/, "")
  const anims = req.animations ?? []
  const animated = req.kind === "sprite-sheet" || (req.kind === "tileset" && anims.length > 0)
  const expected = expectedFiles(req)
  if (req.kind === "audio" || req.kind === "model3d") {
    const stem = expected[0]!.replace(/\.[a-z0-9]+$/i, "")
    const found = (ALT_EXT[req.kind] ?? []).some((ext) => io.files.has(`${stem}.${ext}`))
    if (!found) reasons.push(`missing: ${stem}.(${(ALT_EXT[req.kind] ?? []).join("|")})`)
    return { ok: !reasons.length, reasons, warnings }
  }
  for (const f of expected) if (!io.files.has(f)) reasons.push(`missing: ${f}`)
  const fs = frameSizeOf(req)
  if (animated) {
    const atlas = io.atlas
    if (!atlas || !Array.isArray(atlas.frames)) reasons.push(`atlas unreadable: ${base}/${req.name}.json`)
    else {
      if (fs && (atlas.frameW !== fs.w || atlas.frameH !== fs.h)) reasons.push(`atlas frame size ${atlas.frameW}x${atlas.frameH} ≠ ${req.frameSize}`)
      const names = new Map<string, number>()
      for (const f of atlas.frames) names.set(f.name, (names.get(f.name) ?? 0) + 1)
      for (const a of anims) {
        const present = Array.from({ length: a.frames }, (_, i) => frameName(req.name, a.name, i)).filter((n) => names.has(n))
        if (present.length !== a.frames) reasons.push(`frames ${a.name}: ${present.length}/${a.frames} in the atlas`)
      }
      const dup = Array.from(names.entries()).filter(([, n]) => n > 1).map(([n]) => n)
      if (dup.length) reasons.push(`duplicate atlas frames: ${dup.slice(0, 5).join(", ")}`)
      const extra = atlas.frames.length - anims.reduce((n, a) => n + a.frames, 0)
      if (extra > 0) warnings.push(`${extra} extra frame(s) in the atlas`)
      if (fs) {
        const bad = atlas.frames.filter((f) => f.w !== fs.w || f.h !== fs.h)
        if (bad.length) reasons.push(`${bad.length} atlas frame(s) are not ${req.frameSize}`)
      }
      const sheet = io.png.get(`${base}/${req.name}.png`)
      if (sheet === null) reasons.push(`sheet is not a PNG: ${base}/${req.name}.png`)
      else if (sheet) {
        if (!sheet.hasAlpha) reasons.push("sheet has no alpha channel (background not removed)")
        const maxX = Math.max(0, ...atlas.frames.map((f) => f.x + f.w))
        const maxY = Math.max(0, ...atlas.frames.map((f) => f.y + f.h))
        if (maxX > sheet.width || maxY > sheet.height) reasons.push(`atlas frames exceed the sheet (${sheet.width}x${sheet.height})`)
      }
      for (const a of anims) {
        const first = io.png.get(`${base}/${frameName(req.name, a.name, 0)}.png`)
        if (first === null) reasons.push(`frame is not a PNG: ${frameName(req.name, a.name, 0)}.png`)
        else if (first && fs && (first.width !== fs.w || first.height !== fs.h)) reasons.push(`${frameName(req.name, a.name, 0)}.png is ${first.width}x${first.height}, expected ${req.frameSize}`)
        else if (first && !first.hasAlpha) reasons.push(`${frameName(req.name, a.name, 0)}.png has no alpha channel`)
      }
    }
  } else {
    const png = io.png.get(`${base}/${req.name}.png`)
    if (png === null) reasons.push(`not a PNG: ${base}/${req.name}.png`)
    else if (png) {
      if (fs && (png.width !== fs.w || png.height !== fs.h)) reasons.push(`${req.name}.png is ${png.width}x${png.height}, expected ${req.frameSize}`)
      const needsAlpha = req.kind === "tileset" || /transparen|alpha|cutout/i.test(req.notes ?? "")
      if (needsAlpha && !png.hasAlpha) reasons.push(`${req.name}.png has no alpha channel`)
    }
  }
  return { ok: !reasons.length, reasons, warnings }
}

export function pendingSummary(requests: ModelRequest[]): Array<{ name: string; kind: ModelRequestKind; frames: number; frameSize?: string; status: ModelRequest["status"] }> {
  return requests.filter((r) => r.status !== "accepted").map((r) => ({ name: r.name, kind: r.kind, frames: totalFrames(r), frameSize: r.frameSize, status: r.status }))
}

/** `# MODEL` manifest the integration AI receives. */
export function modelManifest(requests: ModelRequest[]): string {
  const accepted = requests.filter((r) => r.status === "accepted")
  const open = requests.filter((r) => r.status !== "accepted")
  const lines = [MODEL_REPORT_HEADING]
  for (const r of accepted) {
    const files = expectedFiles(r)
    const anims = (r.animations ?? []).map((a) => `${a.name}×${a.frames}`).join(", ")
    const main = r.kind === "sprite-sheet" || (r.kind === "tileset" && r.animations?.length) ? `${r.target}/${r.name}.png + ${r.name}.json` : files[0]!
    lines.push(`- ${r.name} (${r.kind}) → ${main}${anims ? ` · frames: ${anims}` : ""}${r.frameSize ? ` · ${r.frameSize}` : ""} · load: ${r.codeHook ?? "wire it where the placeholder was loaded"}${r.reasons?.length ? ` · ⚠ forced accept: ${r.reasons.join("; ")}` : ""}`)
  }
  lines.push("")
  lines.push("Atlas format: `{frameW, frameH, columns, frames:[{name,x,y,w,h}]}`; frame names `<name>_<anim>_<NN>` (NN from 00); frames are also present as single PNGs next to the sheet. Sample with nearest-neighbour. Do not redraw, regenerate or replace these assets.")
  if (open.length) {
    lines.push("# UNRESOLVED")
    for (const r of open) lines.push(`- ${r.name} (${r.kind}) ${r.status}${r.reasons?.length ? `: ${r.reasons.join("; ")}` : ""} — keep its placeholder`)
  }
  return lines.join("\n")
}

/** `MODEL-PLUS.md`: the manifest plus every request's original sheet prompt (provenance). */
export function modelDoc(requests: ModelRequest[], folder: string): string {
  const parts = [`# Model Plus — asset contract`, "", `Assets live under \`${folder}/<name>/\`. State mirror: \`${MODEL_STATE_REL}\`.`, "", modelManifest(requests), "", "## Requests"]
  for (const r of requests) {
    parts.push(`### ${r.name} — ${r.subject} (${r.kind}, ${r.status})`)
    if (r.animations?.length) parts.push(`Animations: ${r.animations.map((a) => `${a.name} × ${a.frames}`).join(", ")}${r.frameSize ? ` · frame ${r.frameSize}` : ""}`)
    if (r.delivered) parts.push(`Delivered: ${r.delivered.path}`)
    if (r.reasons?.length) parts.push(`Notes: ${r.reasons.join("; ")}`)
    parts.push("", "```", r.sheetPrompt, "```", "")
  }
  return parts.join("\n")
}

/** Art director brief: read-only inspection → the contract. */
export function artDirectorBrief(i: { digest: string; uydurma?: string; kit?: string; style?: string; folder: string }): string {
  const blocks = [
    "You are the ART DIRECTOR step (Model Plus) of a game project. READ-ONLY: do not create, modify, delete or move any file; do not run installers, formatters or git commands that change the tree (reading files, grep and running the game to observe are fine).",
    "Your job: inspect the project and write the ASSET CONTRACT — every piece of art, audio or 3D the game needs NOW to replace its placeholders or script-drawn stand-ins (fundamentals only: playable characters, enemies, key objects, tiles, essential UI, core sounds; no polish, no marketing art). A human will generate each request with an external image AI as ONE packed sheet and hand it back; a converter step then slices it and a validator checks it against your numbers, so every number you write is binding.",
    `Rules:
- One request per SUBJECT (one sheet each): "mario", "goomba", "coin", "tiles_grass"… name = lowercase slug.
- For animated subjects list every animation with an exact frame count (idle, walk, run, jump, fall, attack, hit, death… only the ones the code actually plays or clearly needs).
- frameSize "WxH" must match the sprite size the renderer draws (read the code: tile size, sprite scale, collision box) — not a guess.
- view: side / top-down / isometric / front, as the game renders it.
- target: a folder under ${i.folder}/<name> (default) — do not point at existing asset paths.
- codeHook: the file (and function) that loads/draws the placeholder today, so the integration AI knows where to wire the real asset.
- notes: palette, outline, era, transparency needs, anything the artist must respect.
- Audio and 3D are separate requests of kind "audio" / "model3d". Textures/backgrounds: kind "texture" or "image" with frameSize = the exact pixel size.
- Prefer fewer, complete requests over many tiny ones; never list assets that already exist as real art.`,
    `Reply with a short rationale (max 15 lines), then the heading ${MODEL_REQUESTS_HEADING} on its own line followed by ONE JSON array and nothing after it:
[
  {"name":"mario","kind":"sprite-sheet","subject":"Mario, the player","animations":[{"name":"idle","frames":2},{"name":"walk","frames":8},{"name":"jump","frames":4},{"name":"hit","frames":3}],"frameSize":"64x64","view":"side","target":"${i.folder}/mario","codeHook":"src/entities/player.ts drawPlayer()","notes":"red cap, blue overalls, thick dark outline, 16-bit palette"},
  {"name":"coin_pickup","kind":"audio","subject":"coin pickup sound","target":"${i.folder}/coin_pickup","codeHook":"src/audio/sfx.ts"}
]
Allowed kinds: sprite-sheet, texture, tileset, image, model3d, audio.`,
  ]
  if (i.kit) blocks.splice(2, 0, `Project kit: ${i.kit}.`)
  if (i.style) blocks.splice(2, 0, `Visual style the contract must enforce: ${i.style}.`)
  if (i.uydurma?.trim()) blocks.push(`Placeholder manifest (uydurma.json) already in the project — these are the stand-ins to replace, keep their intent:\n${i.uydurma.trim().slice(0, 6000)}`)
  if (i.digest?.trim()) blocks.push(`Repo digest (already discovered — open a file only to read the exact sprite sizes and loaders):\n${i.digest.trim()}`)
  return blocks.join("\n\n")
}

/** Converter brief for one delivered sheet: owns `target`, must produce exactly the expected files. */
export function converterBrief(i: { req: ModelRequest; deliveredRel: string; build: string; expected: string[] }): string {
  const r = i.req
  const anims = r.animations ?? []
  const fs = frameSizeOf(r)
  const policy = DONUSTURUCU_POLICY.replace(/Rules: the source folder is read-only;[\s\S]*?instead of --force\./, `Rules: the delivered file is read-only; this step OWNS \`${r.target}/\` — write there with --out ${r.target} and pass --force when re-converting after a rejection (nothing else owns it).`)
  const recipe =
    r.kind === "sprite-sheet" || (r.kind === "tileset" && anims.length)
      ? [
          `Recipe (sprite sheet, ${anims.length} animation row(s)):`,
          `1. python3 .silent/tools/donusturucu.py inspect ${i.deliveredRel} — then LOOK at the image: count rows and columns, measure the cell size, origin, gap and any caption strip. Rows are, in order: ${anims.map((a) => `${a.name} (${a.frames} frames)`).join(", ")}. An animation longer than the row wraps to the next row.`,
          `2. grid --cols C --rows R --cell WxH [--origin x,y] [--gap g] [--label h] --names ${anims.flatMap((a) => Array.from({ length: a.frames }, (_, k) => frameName(r.name, a.name, k))).join(",")} --out ${r.target} (cut exactly these ${totalFrames(r)} cells, in reading order; skip empty trailing cells).`,
          `3. removebg on every cut frame (flat background or magenta key: --key #ff00ff if that is the background).`,
          fs ? `4. resize --size ${r.frameSize} (nearest-neighbour; keep the subject centred, do not stretch — pad transparent if the aspect differs).` : "4. keep the native frame size (no frameSize given).",
          `5. pack --name ${r.name}${fs ? ` --frame ${r.frameSize}` : ""} --columns ${Math.min(8, Math.max(1, ...anims.map((a) => a.frames)))} --out ${r.target} → ${r.target}/${r.name}.png + ${r.name}.json (frame names must be the ones above).`,
        ].join("\n")
      : r.kind === "audio"
        ? `Recipe (audio): python3 .silent/tools/donusturucu.py wav ${i.deliveredRel} --rate 44100 --bits 16 --normalize --trim-silence --out ${r.target} and name the result ${r.name}.wav.`
        : r.kind === "model3d"
          ? `Recipe (3D): python3 .silent/tools/donusturucu.py model inspect ${i.deliveredRel}; then model normalize/convert --to glb --out ${r.target} → ${r.target}/${r.name}.glb (origin at the base, +Y up).`
          : `Recipe (single image): inspect, removebg if a flat background is present${fs ? `, resize --size ${r.frameSize} (nearest-neighbour)` : ""}, convert --to png --out ${r.target} → ${r.target}/${r.name}.png.`
  return [
    policy,
    `Project root: ${i.build}. Delivered by the user for the request below: ${i.deliveredRel}`,
    `Request (the contract — numbers are binding):\n${JSON.stringify({ name: r.name, kind: r.kind, subject: r.subject, animations: r.animations, frameSize: r.frameSize, view: r.view, notes: r.notes, target: r.target }, null, 2)}`,
    recipe,
    `Expected output files (a validator checks exactly these, plus frame counts, sizes and alpha):\n${i.expected.map((f) => `- ${f}`).join("\n")}`,
    `Finish with ${MODEL_DELIVERY_HEADING} listing every file you produced (one per line, relative path), then # UNRESOLVED with anything you could not satisfy and why. Nothing after that.`,
  ].join("\n\n")
}
