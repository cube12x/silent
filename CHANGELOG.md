# Changelog

## [0.3.0] — unreleased

### Added
- Blueprint: **Özel AI** (base instructions + GitHub repositories cloned into `.silent/refs` before every run), **node terminal** on four quick clicks (Stop, Esc), **Paralel** button (fan-out, join before the integrator), team roster under orchestration nodes, full-screen canvas.
- Linux, macOS and Windows builds from GitHub Actions (`ci.yml`, `release.yml`); MIT license.

### Fixed
- Executor: a model the CLI cannot use (401/403/quota/rate limit) now falls straight to the next pool model instead of failing the task.
- Blueprint: build context is found through a button (Build → Paralel → prompt → AI); the run walk never passes through an Uydurma stub; a failed run no longer paints the Build folder red; drag-drop listener registered once per canvas.
