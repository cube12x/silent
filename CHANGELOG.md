# Changelog

## [Unreleased]

### Added
- **MindMirror (Mind mode).** Entry screen on every launch (Maker / Mind) and a Maker⇄Mind switch in the sidebar. A Mind model pairs **Bilinç** (expensive, read-only: thinks, finds, writes an `EYLEM:` block when action is needed) with **Eylem** (cheaper, acts in the workspace within the allowed tools, reports under `# SONUÇ`). Buttons: Model, Gateway (main-mind prompt + derived profile), Hafıza deposu (pinned memory), Araçlar (Eylem tools + workspace), Start / Reset; chat with coloured actor chips, Eylem terminal, live memory panel (auto-extracted after every turn + `/hatirla`). Slash commands `/model`, `/plan`, `/act`, `/effort`, `/hatirla`, `/unut`, `/durum`, `/reset`. CLI: `silent mind "<model>" "<message>"`, `silent mind start|reset "<model>"`, `silent mind term "<model>" "<command>"`.
- `runSingle` streams text deltas (`onDelta`) and can run workspace-write without network.

### Fixed
- CI: Windows build (unix-only process group in the relauncher) and the Linux snapshot test (git identity) — red since 2026-09-30.

## [0.3.1] — 2026-09-30

### Added
- Blueprint: **3D model preview** in the Dosyalar tab (three.js; glb/gltf/fbx/obj/stl/ply/dae/3ds, animation clips) and converter `model inspect/convert/normalize` (trimesh).
- Blueprint: **Dosyalar** tab (category cards, atlas animation previews, AI classify) + **Tamirci AI** (repair one reported problem with a chosen model, repos and attached files; `silent bp fix`).
- Blueprint: **Dönüştürücü** role + bundled `donusturucu.py` (inspect/convert/resize/trim/crop/removebg/split/pack/palette/wav); every AI and orchestration worker gets the converter toolkit; lint `donusturucu.noSource`.
- Blueprint: **effort** setting per AI box (CLI-verified levels), **AI ile düzenle** (the designer edits the open blueprint in place; `silent bp edit`), team roster wording, "Sadece bu kutu" (run one box without continuing the chain).
- Every worker and blueprint AI is warned about module shadowing (`x.ts` beside `x/`).
- CLI: `silent bp fix <blueprint> "<problem>" [--file …]`.

### Fixed
- Quit kills every CLI child (children registry + orphan reaping on start); a second trigger during planning no longer starts a second orchestration.
- Planner: one repair round when a reply is not a JSON plan, and the error names what came back; the converter toolkit line no longer pollutes orchestration prompts.
- Converter outputs are write-once (`--force` to overwrite); a Dönüştürücü runs from its own purpose; Claude sessions can no longer end early via ScheduleWakeup/Cron/plan-mode tools.
- Blueprint `meta` (Tamirci preset) is persisted; Dosyalar indexes built by an older heuristic are rebuilt automatically.

## [0.3.0] — 2026-09-29

### Added
- Blueprint: **Bilinç → Eylem** roles (read-only investigator on an expensive model writes a report; a cheap model applies it).
- Blueprint: **Özel AI** (base instructions + GitHub repositories cloned into `.silent/refs` before every run), **node terminal** on four quick clicks (Stop, Esc), **Paralel** button (fan-out, join before the integrator), team roster under orchestration nodes, full-screen canvas.
- Linux, macOS and Windows builds from GitHub Actions (`ci.yml`, `release.yml`); MIT license; unsigned-app instructions in the README.
- First-run **Setup** screen (prerequisites, five recommended CLIs with one-click install and login, `silent` command); Settings → workspace folder; UI language follows the OS on first run.
- Cross-platform runtime: `.exe/.cmd` resolution and npm-shim unwrapping on Windows, Windows/Linux login terminals, app data/log dirs via Tauri, python-free `silent` launcher that hands its arguments to the running app (single instance), every CLI child cancelled on quit.

### Fixed
- Executor: a model the CLI cannot use (401/403/quota/rate limit) now falls straight to the next pool model instead of failing the task.
- Grok login command drift between the TS and Rust registries (guarded by a test); Antigravity listed in the README.
- Blueprint: build context is found through a button (Build → Paralel → prompt → AI); the run walk never passes through an Uydurma stub; a failed run no longer paints the Build folder red; drag-drop listener registered once per canvas.
