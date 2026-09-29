# Dönüştürücü (asset converter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Blueprint AI box role "Dönüştürücü" plus a bundled Python tool that turn produced assets (PNG sheets, photos, WAVs) into the format the next AI needs, and let every AI convert on demand.

**Architecture:** Third `BpAiRole` value `donusturucu`; a bundled `donusturucu.py` (Pillow + numpy) synced to `<project>/.silent/tools/` for every AI run that works inside a project; a `DONUSTURUCU_POLICY` prompt block; the box's `# CONVERTED` manifest becomes `data.report` and reaches downstream AIs through the existing `reports` plumbing. Orchestration worker briefs mention the toolkit.

**Tech Stack:** TypeScript (React 19, Zustand, Vitest), Python 3 (Pillow, numpy, unittest), Tauri backend `blueprintWriteTool`.

**Spec:** `docs/superpowers/specs/2026-09-29-donusturucu-design.md`

## Global Constraints

- No new npm or Rust dependencies. Python tool uses only Pillow + numpy + stdlib; degrade gracefully (clear error text) when Pillow is missing.
- The converter never modifies files in its source folder; output goes to `assets/converted/` unless `--out` says otherwise.
- Every new user-facing string exists in both `src/i18n/tr.ts` and `src/i18n/en.ts` (parity test).
- Existing behaviour of Bilinç/Eylem, Uydurma and Paralel must not change (their tests stay green).
- Never restart or reinstall Silent while a run is active.

---

### Task 1: `donusturucu.py` tool with unit tests

**Files:**
- Create: `src/engine/blueprint/tools/donusturucu.py`
- Create: `src/engine/blueprint/tools/donusturucu_test.py`
- Modify: `.github/workflows/ci.yml` (web job: `pip install pillow numpy` + `python3 -m unittest discover -s src/engine/blueprint/tools -p '*_test.py'`)

**Interfaces:**
- Produces CLI: `python3 .silent/tools/donusturucu.py <cmd> ...` with commands `inspect`, `convert`, `resize`, `trim`, `crop`, `removebg`, `split`, `pack`, `palette`, `wav`. Every command prints one line per output file `→ <path>` and ends with `# CONVERTED` manifest lines `- <src> → <dst> · <op> · <note>` when `--manifest` is given (default on). Exit 0 on success, 2 on usage error, 1 on failure.
- All commands take `--out DIR` (default `assets/converted`) and never write into the input folder.

- [ ] **Step 1: Write the failing tests** (`donusturucu_test.py`): build fixtures in a temp dir with Pillow (a 64×32 RGBA sheet of two 32×32 frames on a solid magenta background, a 40×40 JPEG-like RGB image with a white background and a centred red square, a 1-second 8-bit mono 22050 Hz WAV), then assert:
  - `inspect` prints `hero.png 64x32 RGBA alpha=no frames?=2x1@32` style lines and JSON with `--json`.
  - `convert --to png` on the RGB file writes `<out>/photo.png` mode RGBA.
  - `resize --scale 2` writes 128×64 with nearest-neighbour (pixel (0,0) colour preserved at (1,1)).
  - `trim` on the white-background image writes an image whose size equals the red square bbox.
  - `removebg` with no rembg makes corner pixels alpha 0 and the red square alpha 255, and prints `removebg: flood-fill (rembg not installed)`.
  - `split --frame 32x32` writes `hero_0.png`, `hero_1.png` each 32×32.
  - `pack --frame 32x32` on those two frames writes `hero_sheet.png` 64×32 and `hero_sheet.json` with `frames` entries `{name,x,y,w,h}`.
  - `palette --colors 4` writes a P-mode image with ≤ 4 colours.
  - `wav --rate 44100 --bits 16 --normalize` writes a 16-bit 44100 Hz WAV whose peak ≥ 0.9.
  - Every command writes only under `--out`, the source folder mtime listing is unchanged.
- [ ] **Step 2: Run** `python3 -m unittest src/engine/blueprint/tools/donusturucu_test.py -v` → FAIL (module missing).
- [ ] **Step 3: Implement** `donusturucu.py` (argparse subcommands; helpers `load(path)`, `save(img, dst)`, `flood_bg(img, tol)`, `color_key(img, rgb, tol)`, `frames_guess(w,h)`, `wav_read/wav_write` with `wave` + numpy; `--manifest` printing; try `import rembg` inside `removebg`).
- [ ] **Step 4: Run tests** → PASS. Also `python3 src/engine/blueprint/tools/donusturucu.py --help` prints usage.
- [ ] **Step 5: Commit** `feat(tools): donusturucu.py asset converter (+tests)`.

### Task 2: Domain, prompt policy, report extraction

**Files:**
- Modify: `src/domain/blueprint.ts:43` (`export type BpAiRole = "bilinc" | "eylem" | "donusturucu"`)
- Modify: `src/engine/blueprint/prompt.ts` (add `DONUSTURUCU_POLICY`, `CONVERTER_TOOLKIT`, `AiPromptInput.role` widen, `AiPromptInput.converterTool?: boolean`, `reports` items gain optional `kind: "bilinc" | "donusturucu"`, `eylemBrief` → keep; new `convertedBrief(reports)`; `aiTaskText` includes both; `extractReport` recognises `# CONVERTED` as well as `# FINDINGS`)
- Create: `src/engine/blueprint/donusturucu.ts` (`export { DONUSTURUCU_TOOL_SOURCE }` via `?raw`, `DONUSTURUCU_TOOL_NAME = "donusturucu.py"`)
- Test: `src/engine/blueprint/prompt.test.ts`

**Interfaces:**
- `DONUSTURUCU_POLICY: string` — the role block (tool usage, output folder, manifest format).
- `CONVERTER_TOOLKIT: string` — one paragraph for every AI: "Converter toolkit at .silent/tools/donusturucu.py … if an asset is unusable convert it instead of reporting it".
- `convertedBrief(reports: Array<{title; report; kind?}>): string` — "Converted assets" block listing manifests of wired donusturucu nodes.
- `extractReport(text)` → slice from the last `# FINDINGS` or `# CONVERTED` heading (whichever is later).

- [ ] **Step 1: Failing tests**: (a) `buildAiPrompt({wired:"x", role:"donusturucu", existingProjectAt:"/p", converterTool:true})` contains `DONUSTURUCU` policy after "Work inside" and before `# Base instructions`; (b) `converterTool:true` without role adds `Converter toolkit` line; without the flag it is absent; (c) `aiTaskText({wired:"x", reports:[{title:"Dönüştürücü", report:"# CONVERTED\n- a.png → assets/converted/a.png · removebg", kind:"donusturucu"}]})` contains "Converted assets" and the manifest, and NOT "EYLEM"; (d) `extractReport("chatter\n# CONVERTED\n- x")` → starts with `# CONVERTED`.
- [ ] **Step 2: Run** `npx vitest run src/engine/blueprint/prompt.test.ts` → FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Policy text:
  ```
  You are the DÖNÜŞTÜRÜCÜ (converter) step. Your job: bring the assets wired into you into the exact format the next step needs (see Purpose and the wired prompts). Use the bundled tool, never hand-write image bytes:
    python3 .silent/tools/donusturucu.py inspect <folder>            # what is there (size, mode, alpha, frame guess)
    ... convert|resize|trim|crop|removebg|split|pack|palette|wav (see --help)
  Rules: read-only on the source folder; write only under assets/converted/ (or the folder the Purpose names); keep pixel art nearest-neighbour; if rembg is missing the tool flood-fills the background and says so — mention it. Finish with the manifest and nothing after it:
  # CONVERTED
  - <source> → <output> · <operation> · <why>
  # UNRESOLVED
  - what you could not convert and what the next step should do
  ```
- [ ] **Step 4: Run tests** → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(blueprint): donusturucu role prompt + converter toolkit block`.

### Task 3: Store execution path

**Files:**
- Modify: `src/stores/blueprints.ts` (`execAi` ~lines 509-620), `src/stores/runs.ts` (`start`: write the tool into `repoPath`)
- Modify: `src/engine/executor.ts:441` (brief line after "Editing:")
- Test: `src/engine/executor.test.ts` (brief contains `donusturucu.py`), store behaviour covered by prompt tests + smoke

**Interfaces:**
- `execAi`: `reports` = for eylem: bilinc reports (unchanged) PLUS for every AI: incoming nodes with `role === "donusturucu"` and a report → `{title, report, kind:"donusturucu"}`; `role === "donusturucu"` runs `runSingle` (never orchestration), `readOnly:false`, stores `extractReport(res.text)` as `data.report`, never creates a Build node (like bilinc); before every run with a `cwd` the store calls `backend.blueprintWriteTool(cwd, DONUSTURUCU_TOOL_NAME, DONUSTURUCU_TOOL_SOURCE)` and passes `converterTool: true` to `buildAiPrompt`.
- `runs.start(run)`: `await backend.blueprintWriteTool(run.repoPath, DONUSTURUCU_TOOL_NAME, DONUSTURUCU_TOOL_SOURCE)` inside a try/catch (log on failure, never block the run).
- Executor brief line: "Converter toolkit: `python3 .silent/tools/donusturucu.py --help` (inspect/convert/resize/trim/crop/removebg/split/pack/palette/wav; Pillow+numpy). When an asset is in the wrong format, size or has a background, convert it into assets/converted/ instead of reporting it unusable."

- [ ] **Step 1: Failing test**: executor test "every worker brief carries…" also expects `/Converter toolkit:/`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** store + runs + executor. **Step 4:** `npx vitest run src/engine src/stores` → PASS; `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `feat(blueprint): run Dönüştürücü boxes, ship converter tool into every run`.

### Task 4: Graph lint

**Files:**
- Modify: `src/engine/blueprint/graph.ts:129-131` (add `donusturucu.noSource`: a donusturucu AI with no incoming build/buildPhoto/stub/ai node)
- Test: `src/engine/blueprint/graph.test.ts`

- [ ] Failing test → implement → PASS → commit `feat(blueprint): lint donusturucu.noSource`.

### Task 5: UI + i18n + auto-blueprint + docs

**Files:**
- Modify: `src/features/blueprint/nodes.tsx:75,84` (icon `Wand2`, hint), `src/features/blueprint/BlueprintScreen.tsx:29-35,266,373-378` (MENU entry `donusturucu`, title on add, role panel shows report for donusturucu), `src/i18n/tr.ts`, `src/i18n/en.ts` (keys: `bp.menu.donusturucu`, `bp.node.donusturucu`, `bp.roleHint.donusturucu`, `bp.warn.donusturucu.noSource`, `bp.buttonHint`-style purpose placeholder `bp.donusturucuPurposePlaceholder`)
- Modify: `src/engine/blueprint/autoBlueprint.ts:40,67,124` (enum + RULES line: "ai role donusturucu: put it between an asset producer (art AI/buildPhoto/stub filler) and the consumer AI when the consumer needs a specific format; single mode, cheap model; purpose states the target format")
- Modify: `README.md`, `README.en.md` (feature row), `CHANGELOG.md`
- Test: `src/engine/blueprint/autoBlueprint.test.ts` (role donusturucu survives materialize), i18n parity test (exists)

- [ ] Failing autoBlueprint test → implement → `npm run typecheck && npm run lint && npx vitest run` → PASS → commit `feat(blueprint): Dönüştürücü box in menu, auto-blueprint and docs`.

### Task 6: Verification

- [ ] `cargo test --workspace` (registry drift test unaffected), `npx vitest run`, python unittest, `npm run build`.
- [ ] Preview smoke (Playwright python on `npm run dev` port): right-click canvas → "Dönüştürücü AI" → node appears with Wand2 icon and role panel hint.
- [ ] If no run is active: `npm run tauri build`, install to /Applications, reopen. Then Mario: `silent bp edit bp_mumsii64z_855916c8 "Art Galerisi ile Entegrasyon AI arasına Dönüştürücü AI ekle: hedef 16x16 ve 32x32 şeffaf PNG kareler, sprite sheet + atlas, çıktı assets/converted"`, run it, check `assets/converted/` and the manifest in the box.
- [ ] Update memory + push.
