import { create } from "zustand"
import { getBackend } from "@/services"
import { HEURISTIC_VERSION, buildHeuristicIndex, mergeIndex, parseIndex, type AtlasJson, type FilesIndex } from "@/engine/files/index"
import { classifyPrompt, extractIndexJson } from "@/engine/files/classify"
import { runSingle } from "@/engine/blueprint/single"
import { reportError } from "./notify"

export interface FolderFiles {
  index: FilesIndex | null
  loading: boolean
  classifying: boolean
  stale: boolean
  error?: string
  /** The last Tamirci run's outcome for this folder (report + files changed since it started). */
  lastFix?: { at: number; changed: string[]; report?: string; nodeId: string }
}

interface FilesState {
  byRoot: Record<string, FolderFiles>
  /** Cached index from the DB, or a fresh heuristic build when there is none. */
  load(root: string): Promise<void>
  /** Heuristic rebuild (keeps AI-assigned links) and persist. */
  rebuild(root: string): Promise<void>
  /** Read-only AI pass on a cheap model: corrects categories/titles and links code files. */
  classify(root: string, modelRef: string): Promise<void>
  /** Files changed after the index was built → stale badge. */
  checkStale(root: string): Promise<void>
  setLastFix(root: string, fix: FolderFiles["lastFix"]): void
  /** A model preview learned its animation clips: remember them on the item (shown as anims, persisted). */
  setPreviewAnims(root: string, itemId: string, file: string, names: string[]): void
}

const key = (root: string) => `files-index:${root}`

const atlasJson = (text: string | null): AtlasJson | null => {
  if (!text) return null
  try {
    const raw = JSON.parse(text) as { frames?: unknown }
    return Array.isArray(raw.frames) ? { frames: (raw.frames as Array<{ name?: unknown }>).filter((f) => typeof f?.name === "string").map((f) => ({ name: f.name as string })) } : null
  } catch {
    return null
  }
}

async function heuristic(root: string): Promise<FilesIndex> {
  const backend = await getBackend()
  const files = await backend.listProjectFiles(root)
  const atlases: Record<string, AtlasJson> = {}
  // An atlas is a JSON with `frames[]` next to a sheet; only look at JSONs that have a sibling image.
  const names = new Set(files.map((f) => f.rel))
  for (const f of files) {
    if (!/\.json$/i.test(f.rel) || f.size > 512 * 1024) continue
    const sibling = [".png", ".webp", ".jpg", ".jpeg"].some((ext) => names.has(f.rel.replace(/\.json$/i, ext)))
    if (!sibling) continue
    const parsed = atlasJson(await backend.readProjectFile(root, f.rel, 512 * 1024))
    if (parsed) atlases[f.rel] = parsed
  }
  return buildHeuristicIndex(root, files, atlases, Date.now())
}

export const useFilesStore = create<FilesState>((set, get) => ({
  byRoot: {},
  async load(root) {
    const cur = get().byRoot[root]
    if (cur?.loading) return
    set((s) => ({ byRoot: { ...s.byRoot, [root]: { index: cur?.index ?? null, loading: true, classifying: false, stale: false, lastFix: cur?.lastFix } } }))
    try {
      const backend = await getBackend()
      const cached = await backend.kv.get<string>(key(root))
      const prev = cached ? parseIndex(cached) : null
      // An index built by an older heuristic (no 3D models yet, say) is rebuilt here; AI-assigned links survive the merge.
      const fresh = !prev || prev.heuristic !== HEURISTIC_VERSION
      const index = fresh ? mergeIndex(prev, await heuristic(root)) : prev
      if (fresh) await backend.kv.set(key(root), JSON.stringify(index))
      set((s) => ({ byRoot: { ...s.byRoot, [root]: { ...s.byRoot[root], index, loading: false } } }))
      await get().checkStale(root)
    } catch (e) {
      set((s) => ({ byRoot: { ...s.byRoot, [root]: { ...s.byRoot[root], loading: false, error: e instanceof Error ? e.message : String(e) } } }))
    }
  },
  async rebuild(root) {
    set((s) => ({ byRoot: { ...s.byRoot, [root]: { ...(s.byRoot[root] ?? { index: null, classifying: false, stale: false }), loading: true } } }))
    try {
      const backend = await getBackend()
      const index = mergeIndex(get().byRoot[root]?.index ?? null, await heuristic(root))
      await backend.kv.set(key(root), JSON.stringify(index))
      set((s) => ({ byRoot: { ...s.byRoot, [root]: { ...s.byRoot[root], index, loading: false, stale: false, error: undefined } } }))
    } catch (e) {
      set((s) => ({ byRoot: { ...s.byRoot, [root]: { ...s.byRoot[root], loading: false, error: e instanceof Error ? e.message : String(e) } } }))
    }
  },
  async classify(root, modelRef) {
    const cur = get().byRoot[root]
    if (!cur?.index || cur.classifying) return
    set((s) => ({ byRoot: { ...s.byRoot, [root]: { ...s.byRoot[root], classifying: true, error: undefined } } }))
    try {
      const backend = await getBackend()
      const tree = (await backend.listProjectFiles(root)).map((f) => f.rel)
      const handle = runSingle(backend, { runId: `files:${Date.now()}`, modelRef, prompt: classifyPrompt(cur.index, tree), cwd: root, readOnly: true, timeoutSecs: 15 * 60 })
      const res = await handle.done
      if (!res.ok) throw new Error(res.error ?? "classify failed")
      const corrected = extractIndexJson(res.text)
      if (!corrected) throw new Error("the model did not return a valid index")
      // Keep previews (the model never sees them) and the root; take titles/categories/files/notes from the model.
      const byId = new Map(cur.index.items.map((i) => [i.id, i]))
      const items = corrected.items.map((i) => ({ ...i, previews: byId.get(i.id)?.previews ?? [], ai: true }))
      const index: FilesIndex = { version: 1, builtAt: Date.now(), root, items }
      await backend.kv.set(key(root), JSON.stringify(index))
      set((s) => ({ byRoot: { ...s.byRoot, [root]: { ...s.byRoot[root], index, classifying: false, stale: false } } }))
    } catch (e) {
      reportError(e)
      set((s) => ({ byRoot: { ...s.byRoot, [root]: { ...s.byRoot[root], classifying: false, error: e instanceof Error ? e.message : String(e) } } }))
    }
  },
  async checkStale(root) {
    const cur = get().byRoot[root]
    if (!cur?.index) return
    try {
      const backend = await getBackend()
      const changed = await backend.changedFiles(root, cur.index.builtAt)
      set((s) => ({ byRoot: { ...s.byRoot, [root]: { ...s.byRoot[root], stale: changed.length > 0 } } }))
    } catch {
      /* stale is a hint only */
    }
  },
  setPreviewAnims(root, itemId, file, names) {
    const cur = get().byRoot[root]
    if (!cur?.index) return
    const anims = Object.fromEntries(names.map((n) => [n, [n]]))
    const index: FilesIndex = { ...cur.index, items: cur.index.items.map((i) => (i.id === itemId ? { ...i, previews: i.previews.map((p) => (p.file === file ? { ...p, anims } : p)) } : i)) }
    set((s) => ({ byRoot: { ...s.byRoot, [root]: { ...s.byRoot[root], index } } }))
    void getBackend().then((b) => b.kv.set(key(root), JSON.stringify(index))).catch(() => undefined)
  },
  setLastFix(root, fix) {
    set((s) => ({ byRoot: { ...s.byRoot, [root]: { ...(s.byRoot[root] ?? { index: null, loading: false, classifying: false, stale: false }), lastFix: fix } } }))
  },
}))
