/** Layer 2 of the Dosyalar index: a read-only AI corrects the heuristic index and links code files to items. */
import { CATEGORIES, parseIndex, type FilesIndex } from "./index"

const MAX_TREE = 200

export function classifyPrompt(index: FilesIndex, tree: string[]): string {
  const shown = tree.slice(0, MAX_TREE)
  const more = tree.length > shown.length ? `\n(+${tree.length - shown.length} more)` : ""
  const slim = { ...index, items: index.items.map((item) => ({ id: item.id, title: item.title, category: item.category, files: item.files, notes: item.notes, ai: item.ai })) }
  return [
    "You are classifying what a game project contains for a visual file browser. READ-ONLY: do not create, modify or delete any file; do not run build or install commands. You may read files to decide.",
    `Categories (use only these ids): ${CATEGORIES.join(", ")} — karakterler = playable characters, dusmanlar = enemies/bosses, nesneler = items/pickups/props/UI icons, arkaplanlar = tiles/backgrounds/levels, sesler = audio, sistemler = code systems, diger = unsure.`,
    `Current index (heuristic guesses; keep ids, fix titles/categories, add the code files that implement each item to its "files", merge duplicates by dropping the extra item):\n${JSON.stringify(slim)}`,
    `Project files:\n${shown.join("\n")}${more}`,
    'Reply with one JSON object only — the corrected index in the same shape (version, builtAt, root, items[{id,title,category,files,notes?}]). Mark every item you touched with "ai": true. No prose before or after the JSON.',
  ].join("\n\n")
}

/** The last `{…}` block of the reply (fenced or bare), parsed and validated as an index. */
export function extractIndexJson(text: string): FilesIndex | null {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1].trim())
  const candidates = fenced.length ? fenced : []
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
  for (const c of candidates.reverse()) {
    const parsed = parseIndex(c)
    if (parsed) return parsed
  }
  return null
}
