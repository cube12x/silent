# Dosyalar sekmesi + Tamirci AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Dosyalar" tab in the Blueprint screen that shows what a Build produced (characters, enemies, objects, backgrounds, sounds, code) with animated previews, and a "Tamirci AI" action that fixes one reported problem with a chosen model, repos and attached files.

**Architecture:** Two new backend commands (list files, read blob as base64). A pure-TS heuristic indexer builds `.silent/files-index.json` from atlas JSONs, images, audio and `src/**`; an optional read-only AI pass refines it. A Zustand `files` store loads/rebuilds/classifies the index per Build folder. The tab renders category cards + a preview panel (canvas atlas animation, image, audio). Tamirci creates/reuses AI boxes in the open blueprint and runs them through the existing store path (`run(id, nodeId, { extraPrompt })`), so terminal, tokens, effort and reports all work unchanged. The `silent bp fix` CLI queues the same request.

**Tech Stack:** TypeScript/React 19/Zustand/Vitest, Rust (Tauri commands, `base64` already a dependency? → check; else use `data-encoding` or hand-rolled), i18n tr/en.

**Spec:** `docs/superpowers/specs/2026-09-30-dosyalar-tamirci-design.md`

## Global Constraints

- No new npm dependencies. Rust: reuse an existing base64 crate if present in Cargo.lock; otherwise implement a 20-line encoder in `files.rs` (tested).
- Every new string in both `src/i18n/tr.ts` and `src/i18n/en.ts`.
- Index file path: `<build>/.silent/files-index.json`; never written outside `.silent/`.
- Tamirci never touches git; it runs like any single AI box (workspace-write sandbox).
- Existing tests stay green; `npm run typecheck && npm run lint && npx vitest run && cargo test --workspace`.

---

### Task 1: Backend — list files + read blob

**Files:**
- Modify: `src-tauri/src/commands/files.rs` (add `list_project_files`, `read_project_blob`), `src-tauri/src/lib.rs` (register)
- Modify: `src/services/backend.ts`, `src/services/tauriBackend.ts`, `src/services/testBackend.ts`
- Test: Rust unit tests in `files.rs`

**Interfaces:**
- `listProjectFiles(root: string, maxFiles?: number): Promise<Array<{ rel: string; size: number; mtimeMs: number }>>` — recursive, skips `node_modules`, `.git`, `dist`, `build`, `target`, `.silent`, `__pycache__`, dotfiles; sorted by rel; cap default 5000.
- `readProjectBlob(root: string, rel: string, maxBytes?: number): Promise<{ mime: string; base64: string } | null>` — rejects paths escaping root (reuse `safe_join`), mime from extension (png/jpg/jpeg/gif/webp/bmp/wav/mp3/ogg/json/txt), `maxBytes` default 8 MB.

- [ ] Step 1: Rust tests: temp dir with `a.png`, `src/x.ts`, `node_modules/y.js`, `.silent/z` → list returns `a.png`, `src/x.ts` only; blob of `a.png` returns mime `image/png` and base64 of the bytes; `../etc` rejected.
- [ ] Step 2: `cargo test -p silent` → FAIL. Step 3: implement (walk with `std::fs::read_dir`, budget, `safe_join` from existing helpers). Step 4: PASS.
- [ ] Step 5: TS backend interface + Tauri wrappers (`invoke("list_project_files", { root, maxFiles })`, `invoke("read_project_blob", …)`), TestBackend returns canned entries (`assets/converted/hero.png`, `assets/converted/hero.json`, `src/game/player/index.ts`, `assets/uydurma/sfx__jump.wav`) and a 1×1 PNG base64 blob.
- [ ] Step 6: `npm run typecheck`; commit `feat(backend): list project files + read blob`.

### Task 2: Files index (heuristics + merge)

**Files:**
- Create: `src/engine/files/index.ts`, `src/engine/files/index.test.ts`

**Interfaces:**
```ts
export type FileCategoryId = "karakterler" | "dusmanlar" | "nesneler" | "arkaplanlar" | "sesler" | "sistemler" | "diger"
export interface FilePreview { kind: "atlas" | "image" | "audio"; file: string; json?: string; anims?: Record<string, string[]> /* anim → frame names */ }
export interface FileItem { id: string; title: string; category: FileCategoryId; files: string[]; previews: FilePreview[]; notes?: string; ai?: boolean }
export interface FilesIndex { version: 1; builtAt: number; root: string; items: FileItem[] }
export const CATEGORIES: FileCategoryId[]
export function guessCategory(name: string): FileCategoryId   // hero|player|murkcap→karakterler; enemy|boss|brassbolt|spiker|hopper|crawler→dusmanlar; item|coin|powerup|spore|acorn|berry|cap|wrench→nesneler; tile|bg|sky|cloud|background|world→arkaplanlar
export function groupAtlasFrames(names: string[]): Record<string, Record<string, string[]>>  // prefix → anim → sorted frames (murkcap_idle_00 → murkcap/idle)
export function buildHeuristicIndex(root: string, files: Array<{ rel: string }>, atlases: Record<string, { frames: Array<{ name: string }> }>, now: number): FilesIndex
export function mergeIndex(prev: FilesIndex | null, next: FilesIndex): FilesIndex   // keep prev items' ai-assigned files/category/title by id
export function parseIndex(text: string): FilesIndex | null
```
- [ ] Step 1: tests — `guessCategory("brassbolt")` → dusmanlar; `groupAtlasFrames(["murkcap_idle_00","murkcap_idle_01","murkcap_run_00"])` → `{murkcap:{idle:[…],run:[…]}}`; `buildHeuristicIndex` with hero.json+hero.png, tiles.json, `assets/sprites/photo.jpg`, `assets/uydurma/sfx__jump.wav`, `src/game/player/index.ts` → items: murkcap (karakterler, preview atlas with anims), tiles (arkaplanlar), photo (diger→arkaplanlar by name? keep `diger` unless name matches), sfx__jump (sesler), `game/player` (sistemler, files grouped by top-two folders); `mergeIndex` keeps `ai: true` item's files when the heuristic rebuild has the same id.
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS → Step 5: commit `feat(files): heuristic files index`.

### Task 3: AI classify pass

**Files:**
- Create: `src/engine/files/classify.ts`, `src/engine/files/classify.test.ts`

**Interfaces:**
- `classifyPrompt(index: FilesIndex, tree: string[]): string` — asks for the corrected index as one JSON object (same shape, `ai: true` on touched items), read-only, ≤ 200 files listed.
- `extractIndexJson(text: string): FilesIndex | null` — last `{…}` block, validated (`version === 1`, items array, categories valid).
- [ ] Tests: prompt contains category list + "read-only" + the tree; extractor handles prose around JSON and rejects bad categories. Implement; commit `feat(files): AI classify prompt + parser`.

### Task 4: Files store + Tamirci engine

**Files:**
- Create: `src/stores/files.ts`, `src/engine/blueprint/tamirci.ts`, `src/engine/blueprint/tamirci.test.ts`
- Modify: `src/domain/blueprint.ts` (`Blueprint.meta?: { tamirci?: TamirciPreset }`, `BpAiData.tamirci?: true`), `src/stores/blueprints.ts` (`callTamirci`, `setMeta`)

**Interfaces:**
```ts
// tamirci.ts
export interface TamirciPreset { modelRef: string; instructions?: string; repos?: BpAiRepo[]; effort?: Effort }
export interface TamirciRequest { problem: string; files: string[]; bilinc: boolean; preset: TamirciPreset }
export function tamirciExtraPrompt(req: Pick<TamirciRequest,"problem"|"files">): string
// "# Repair request\n<problem>\n\nAttached files (start here, read them fully before editing):\n- a\n- b\n\nFix the reported problem with the smallest safe change, run the project's tests/typecheck, and finish with:\n# FIXED\n- file — what changed\n# NOT FIXED\n- what remains and why"
export function findTamirciBoxes(bp: Blueprint): { eylem?: BpNode; bilinc?: BpNode }
// store: callTamirci(bpId: string, req: TamirciRequest): Promise<{ nodeId: string }>  — creates boxes (eylem: role undefined unless bilinc, title "Tamirci AI", data.tamirci = true, wired Build → box; bilinc: role "bilinc", title "Tamirci Bilinç", wired Build → bilinc → eylem(role "eylem")), saves preset into bp.meta, runs bilinc first then eylem (or eylem alone) via run(id, nodeId, { extraPrompt, only: true }); after run: node.data.report = extractReport(last reply) (already stored for bilinc; for eylem store the summary text via a new `data.report` write in execAi when data.tamirci), and files store records changedFiles(root, startedAt) under `lastFix`.
// files store
interface FilesState { byRoot: Record<string, { index: FilesIndex | null; stale: boolean; loading: boolean; error?: string; lastFix?: { at: number; changed: string[]; report?: string } }>; load(root); rebuild(root); classify(root, modelRef); checkStale(root); }
```
- [ ] Tests (pure): `tamirciExtraPrompt` shape; `findTamirciBoxes` finds by `data.tamirci`. Implement store + engine; `npm run typecheck`; commit `feat(blueprint): Tamirci engine + files store`.

### Task 5: UI — Dosyalar tab, previews, Tamirci dialog

**Files:**
- Create: `src/features/blueprint/FilesTab.tsx`, `src/features/blueprint/AtlasAnimPreview.tsx`, `src/features/blueprint/TamirciDialog.tsx`
- Modify: `src/features/blueprint/BlueprintScreen.tsx` (tab state `view: "canvas" | "files"`, header tab buttons replacing the eyebrow), `src/i18n/tr.ts`, `src/i18n/en.ts`

- FilesTab: Build selector (builds wired in bp), toolbar (Yenile, Sınıflandır (AI) with model select, stale badge), category cards grid (items as chips with a tiny first-frame thumbnail when atlas/image), right panel: selected item → previews (AtlasAnimPreview: loads PNG via readProjectBlob → Image; JSON frames; anim tabs; speed 4–12 fps; draws scaled ×4 nearest), `<img>` for images, `<audio>` for wav/mp3/ogg, file list with sizes; "Onarım raporu" section from `lastFix`.
- Context menu (right-click on item chip, category title or file row): "Tamirci AI çağır" → TamirciDialog (model select from installed models, instructions textarea, repos list, problem textarea autofocused, file checklist prefilled, Bilinç toggle, Enter/⌘Enter submits) → `callTamirci`; toast on start; dialog closes; the tab shows a running badge for the box (`useBlueprintsStore.running`).
- i18n keys: `bp.tabs.canvas/files`, `files.*` block (title, refresh, classify, stale, categories.*, noBuild, empty, preview.anim/speed, tamirci.*: call, title, model, problem, problemPlaceholder, files, bilinc, run, running, report, changed, none).
- [ ] Preview smoke script `scripts/smoke-files.py`: open a blueprint, switch to Dosyalar, see TestBackend items, right-click Murkcap → dialog → type problem → Enter → a "Tamirci AI" node exists on the canvas.
- [ ] `npm run typecheck && npm run lint && npx vitest run`; commit `feat(blueprint): Dosyalar tab with previews and Tamirci dialog`.

### Task 6: CLI `silent bp fix`

**Files:**
- Modify: `src-tauri/src/commands/autostart.rs` (`fix` subcommand: `silent bp fix <bp> "<problem>" [--file rel]...` → `blueprint.fix: { problem, files }`), `src/services/backend.ts` (`AutostartRequest.blueprint.fix`), `src/app/AppShell.tsx` (accept `fix`), `src/features/blueprint/BlueprintScreen.tsx` (autorun fix → open TamirciDialog prefilled with the saved preset, or run directly when a preset exists), `README.md`/`README.en.md`/`CHANGELOG.md`
- [ ] Rust test for the grammar; TS parity; commit `feat(cli): silent bp fix`.

### Task 7: Verification

- [ ] All suites green; `npm run tauri build`; install when no run is active; open Mario blueprint → Dosyalar → Murkcap animations play; right-click Nesneler → Tamirci (Opus) with a real problem → box runs → report + changed files shown. Update memory + Graphiti.
