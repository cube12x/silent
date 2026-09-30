# Changelog

## [0.3.0] — 2026-09-29

### Added
- Blueprint: **Dosyalar** tab (category cards, atlas animation previews, AI classify) + **Tamirci AI** (repair one reported problem with a chosen model, repos and attached files; `silent bp fix`).
- Blueprint: **Dönüştürücü** role + bundled `donusturucu.py` (inspect/convert/resize/trim/crop/removebg/split/pack/palette/wav); every AI and orchestration worker gets the converter toolkit; lint `donusturucu.noSource`.
- Blueprint: **Bilinç → Eylem** roles (read-only investigator on an expensive model writes a report; a cheap model applies it).
- Blueprint: **Özel AI** (base instructions + GitHub repositories cloned into `.silent/refs` before every run), **node terminal** on four quick clicks (Stop, Esc), **Paralel** button (fan-out, join before the integrator), team roster under orchestration nodes, full-screen canvas.
- Linux, macOS and Windows builds from GitHub Actions (`ci.yml`, `release.yml`); MIT license; unsigned-app instructions in the README.
- First-run **Setup** screen (prerequisites, five recommended CLIs with one-click install and login, `silent` command); Settings → workspace folder; UI language follows the OS on first run.
- Cross-platform runtime: `.exe/.cmd` resolution and npm-shim unwrapping on Windows, Windows/Linux login terminals, app data/log dirs via Tauri, python-free `silent` launcher that hands its arguments to the running app (single instance), every CLI child cancelled on quit.

### Fixed
- Executor: a model the CLI cannot use (401/403/quota/rate limit) now falls straight to the next pool model instead of failing the task.
- Grok login command drift between the TS and Rust registries (guarded by a test); Antigravity listed in the README.
- Blueprint: build context is found through a button (Build → Paralel → prompt → AI); the run walk never passes through an Uydurma stub; a failed run no longer paints the Build folder red; drag-drop listener registered once per canvas.
