# Silent

**Desktop-first multi-AI orchestration workstation.** One prompt in; Silent decomposes it into subtasks, routes each to the best model in your enabled pool, executes through CLI integrations (Codex CLI is the execution core), and shows everything live in a dark, tactical command-center UI.

> Status: v1 — all ten screens, a real orchestration engine (planner → router → executor with retry / fallback / escalation), real **Codex CLI** execution through a Rust runtime, simulated workers for providers that are not wired yet, SQLite persistence, and a browser demo mode.

## Stack

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (Rust) |
| UI | React 19 · TypeScript 5.9 · Vite 8 · Tailwind v4 · shadcn (radix) · Zustand · react-router 7 |
| Engine | `src/engine` — pure TS, no React/Tauri imports, unit-tested with Vitest |
| Runtime | `crates/silent-runtime` — spawns `codex exec --json`, normalises JSONL into `RuntimeEvent`s, redacts secrets, enforces timeouts and process-group kill |
| Persistence | SQLite (tauri-plugin-sql) + `settings.json` (tauri-plugin-store) |

## Run

```bash
npm install
npm run tauri:dev            # desktop app (needs Rust toolchain + Codex CLI on PATH for real execution)
VITE_SILENT_FAKE_BACKEND=1 npm run dev   # browser demo with in-memory backend and a simulated live run
```

Checks:

```bash
npm run typecheck && npm run lint && npm run test   # TS + engine tests
cargo test --workspace                              # Rust runtime (incl. a real codex exec transcript fixture)
cargo test -p silent-runtime --test real_codex -- --ignored   # spawns the real Codex CLI once (needs `codex login`)
npm run build && npx tauri build --debug --no-bundle
```

## Layout

```
src/app             shell: sidebar · top bar · intelligence panel · command palette · routes
src/design-system   tokens + tactical components (GlowCard, RouteGraph, TerminalView, ModelSelectorGrid…)
src/domain          data model (Provider, Model, Chat, RepoAgent, SilentCodeRun, Subtask, MemoryEntry, Settings, RuntimeEvent)
src/engine          planner · router · gateway interpreter · executor · workers (Simulated)
src/services        backend seam: FakeBackend (browser/tests) · TauriBackend (Rust) · CodexWorker
src/stores          Zustand slices: chats · agents · runs · memory · providers · settings · ui · phone
src/features        screens: dashboard · chat · repo-agents · silent-code · monitor · terminal-drawer · memory · settings · phone-link
crates/silent-runtime   Rust: spawn · codex/args · codex/events · redaction
src-tauri           Tauri commands: app_info · providers_detect · repo_inspect · codex_run_start (Channel) · codex_run_cancel
docs/superpowers/specs  design spec
```

## How execution works

- **Standard chat on Codex** → `codex -a never -s workspace-write [-C repo] exec --json --color never "<prompt>"`; the first turn stores the thread id, later turns use `exec resume <thread>`.
- **Silent Code** → the planner produces a subtask DAG; the router scores every enabled model per subtask kind under the chosen cost mode; the executor runs the DAG (sequential / parallel / staged) with *retry → fallback → escalation*. Subtasks routed to Codex run as `--ephemeral` one-shots (`exec review` for review subtasks); everything else runs on `SimulatedWorker`, which emits the same events so the UI is provider-agnostic.
- **Safety**: approvals are `never`, sandbox is capped at `workspace-write` (read-only when the agent's *Write* permission is off), `danger-full-access` is rejected at the type level, secrets are redacted before output reaches the UI, and raw reasoning text is never surfaced.
- **Git push** is off by default and can never be enabled by a Gateway prompt.

## Out of scope for v1

Real execution for non-Codex providers, the phone WebSocket bridge / APK, repo indexing, API-key storage, auto-update, code signing. Seams exist for each (`Worker` interface, `bridge.rs`, `repoIndex` settings).
