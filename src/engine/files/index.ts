/**
 * Dosyalar tab index: what a Build folder contains, grouped into the categories a game maker thinks in
 * (characters, enemies, objects, backgrounds, sounds, code). Layer 1 is this pure heuristic pass over the
 * file list + atlas JSONs; layer 2 (classify.ts) lets a read-only AI correct it. Stored as
 * `<build>/.silent/files-index.json`.
 */

export type FileCategoryId = "karakterler" | "dusmanlar" | "nesneler" | "arkaplanlar" | "sesler" | "sistemler" | "diger"

export const CATEGORIES: FileCategoryId[] = ["karakterler", "dusmanlar", "nesneler", "arkaplanlar", "sesler", "sistemler", "diger"]

export interface FilePreview {
  kind: "atlas" | "image" | "audio"
  /** Image/audio file (relative to the root). */
  file: string
  /** Atlas JSON next to the sheet. */
  json?: string
  /** Animation name → frame names in play order (atlas previews). */
  anims?: Record<string, string[]>
}

export interface FileItem {
  id: string
  title: string
  category: FileCategoryId
  files: string[]
  previews: FilePreview[]
  notes?: string
  /** Touched by the AI classify pass: category/title/files survive heuristic rebuilds. */
  ai?: boolean
}

export interface FilesIndex {
  version: 1
  builtAt: number
  root: string
  items: FileItem[]
}

export interface AtlasJson {
  frames: Array<{ name: string }>
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i
const AUDIO_EXT = /\.(wav|mp3|ogg)$/i
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|lua|gd)$/i

const CATEGORY_HINTS: Array<[FileCategoryId, RegExp]> = [
  ["dusmanlar", /enem|boss|brassbolt|valvo|spiker|hopper|crawler|monster|villain|goomba|koopa|antagonist|plumber/i],
  ["karakterler", /hero|player|murkcap|morel|character|protagonist|mario|avatar/i],
  ["nesneler", /item|coin|power|pickup|spore|acorn|berry|cap\b|wrench|collect|prop|object|treasure|key\b|ui\b|hud|icon/i],
  ["arkaplanlar", /tile|bg\b|background|sky|cloud|world|terrain|parallax|map|level|scene/i],
]

/** Category from a name: enemies before heroes (a "hero-killer boss" is an enemy), backgrounds last. */
export function guessCategory(name: string): FileCategoryId {
  for (const [cat, re] of CATEGORY_HINTS) if (re.test(name)) return cat
  return "diger"
}

/**
 * `murkcap_idle_00` → prefix `murkcap`, anim `idle`; frames sorted by their numeric suffix. A name without a
 * numbered suffix (`star`, `grass_dirt_a`) is a one-frame `idle` anim under its own prefix.
 */
export function groupAtlasFrames(names: string[]): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, Array<{ n: number; name: string }>>> = {}
  for (const name of names) {
    const m = /^(.*?)_([a-zA-Z]+)_(\d+)$/.exec(name)
    const [prefix, anim, n] = m ? [m[1], m[2], Number(m[3])] : [name, "idle", 0]
    ;((out[prefix] ??= {})[anim] ??= []).push({ n, name })
  }
  const result: Record<string, Record<string, string[]>> = {}
  for (const [prefix, anims] of Object.entries(out)) {
    result[prefix] = {}
    for (const [anim, frames] of Object.entries(anims)) result[prefix][anim] = frames.sort((a, b) => a.n - b.n).map((f) => f.name)
  }
  return result
}

const base = (rel: string) => rel.split("/").pop() ?? rel
const stem = (rel: string) => base(rel).replace(/\.[^.]+$/, "")

/** Layer 1: items from atlas JSON+PNG pairs, loose images, audio files and source folders (two levels deep). */
export function buildHeuristicIndex(root: string, files: Array<{ rel: string }>, atlases: Record<string, AtlasJson>, now: number): FilesIndex {
  const rels = files.map((f) => f.rel)
  const have = new Set(rels)
  const items: FileItem[] = []
  const claimed = new Set<string>()

  for (const [json, atlas] of Object.entries(atlases)) {
    const sheet = [".png", ".webp", ".jpg", ".jpeg"].map((ext) => json.replace(/\.json$/i, ext)).find((p) => have.has(p))
    if (!sheet) continue
    claimed.add(json)
    claimed.add(sheet)
    const groups = groupAtlasFrames(atlas.frames.map((f) => f.name))
    const prefixes = Object.keys(groups)
    const atlasName = stem(json)
    // Many prefixes (tiles, icons) → one item for the whole sheet; few prefixes → one item per character/enemy.
    const perPrefix = prefixes.length > 0 && prefixes.length <= 4 && prefixes.every((p) => Object.values(groups[p]).some((frames) => frames.length > 1))
    if (perPrefix) {
      for (const prefix of prefixes) {
        items.push({ id: `atlas:${atlasName}:${prefix}`, title: prefix, category: guessCategory(prefix) === "diger" ? guessCategory(atlasName) : guessCategory(prefix), files: [sheet, json], previews: [{ kind: "atlas", file: sheet, json, anims: groups[prefix] }] })
      }
    } else {
      const anims: Record<string, string[]> = {}
      for (const prefix of prefixes) for (const [anim, frames] of Object.entries(groups[prefix])) anims[prefix === atlasName ? anim : anim === "idle" ? prefix : `${prefix}_${anim}`] = frames
      items.push({ id: `atlas:${atlasName}`, title: atlasName, category: guessCategory(atlasName), files: [sheet, json], previews: [{ kind: "atlas", file: sheet, json, anims }] })
    }
  }

  for (const rel of rels) {
    if (claimed.has(rel)) continue
    if (IMAGE_EXT.test(rel)) items.push({ id: `image:${rel}`, title: stem(rel), category: guessCategory(stem(rel)), files: [rel], previews: [{ kind: "image", file: rel }] })
    else if (AUDIO_EXT.test(rel)) items.push({ id: `audio:${rel}`, title: stem(rel), category: "sesler", files: [rel], previews: [{ kind: "audio", file: rel }] })
  }

  const codeGroups = new Map<string, string[]>()
  for (const rel of rels) {
    if (!CODE_EXT.test(rel) || !rel.startsWith("src/")) continue
    const parts = rel.split("/")
    const key = parts.slice(0, Math.min(3, parts.length - 1)).join("/")
    ;(codeGroups.get(key) ?? codeGroups.set(key, []).get(key)!).push(rel)
  }
  for (const [key, group] of codeGroups) items.push({ id: `code:${key}`, title: key.replace(/^src\//, ""), category: "sistemler", files: group.sort(), previews: [] })

  // Two atlases with the same character prefix (hero.json and hero_alt.json both drawing "murkcap") would show twice
  // under one name: suffix duplicates with their atlas so the user can tell them apart.
  const seen = new Map<string, number>()
  for (const item of items) seen.set(item.title, (seen.get(item.title) ?? 0) + 1)
  for (const item of items) {
    if ((seen.get(item.title) ?? 0) > 1 && item.id.startsWith("atlas:")) item.title = `${item.title} (${item.id.split(":")[1]})`
  }
  return { version: 1, builtAt: now, root, items }
}

/** Heuristic rebuilds keep what the AI pass decided (title, category, extra files) for items that still exist. */
export function mergeIndex(prev: FilesIndex | null, next: FilesIndex): FilesIndex {
  if (!prev) return next
  const byId = new Map(prev.items.filter((i) => i.ai).map((i) => [i.id, i]))
  return {
    ...next,
    items: next.items.map((item) => {
      const old = byId.get(item.id)
      if (!old) return item
      const files = Array.from(new Set([...item.files, ...old.files]))
      return { ...item, title: old.title, category: old.category, notes: old.notes ?? item.notes, files, ai: true }
    }),
  }
}

/** Strict parse of a stored or AI-returned index; null when the shape or a category is wrong. */
export function parseIndex(text: string): FilesIndex | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (r.version !== 1 || typeof r.root !== "string" || !Array.isArray(r.items)) return null
  const items: FileItem[] = []
  for (const it of r.items as unknown[]) {
    if (!it || typeof it !== "object") return null
    const i = it as Record<string, unknown>
    if (typeof i.id !== "string" || typeof i.title !== "string" || !CATEGORIES.includes(i.category as FileCategoryId) || !Array.isArray(i.files)) return null
    items.push({
      id: i.id,
      title: i.title,
      category: i.category as FileCategoryId,
      files: (i.files as unknown[]).filter((f): f is string => typeof f === "string"),
      previews: Array.isArray(i.previews) ? (i.previews as FilePreview[]).filter((p) => p && typeof p === "object" && typeof p.file === "string" && ["atlas", "image", "audio"].includes(p.kind)) : [],
      notes: typeof i.notes === "string" ? i.notes : undefined,
      ai: i.ai === true ? true : undefined,
    })
  }
  return { version: 1, builtAt: typeof r.builtAt === "number" ? r.builtAt : 0, root: r.root, items }
}
