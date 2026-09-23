# Silent — Multi-AI Orchestration Workstation (v1 plan)

## Context

Silent is a new, desktop-first AI orchestration product: one prompt in, Silent decomposes it into
subtasks, routes each subtask to the best model in the user's enabled pool, executes through
CLI/tool integrations (Codex CLI is first-class infrastructure), and shows everything in a dark,
premium, command-center UI. It is not a chat app with a skin; the UI must sit on a real
orchestration model so that the product is buildable, not a mockup.

Decisions already taken with the user (2026-09-23):

| Decision | Choice |
|---|---|
| Location | `~/CubeCode/silent` (new git repo) |
| Shell | Tauri 2 + Rust backend |
| v1 depth | All 10 screens + real orchestration engine (TS) + **real Codex CLI execution** via Tauri; other providers run as simulated workers behind the same adapter interface |
| Package manager / stack conventions | npm, React 19, Vite, TS 5.9, Vitest, ESLint flat config (matches `~/CubeCode/uygulanabilir-gorev-brifi-1-gorev-me`) |

Verified environment: Node 26.5, cargo 1.97, `codex-cli 0.153.2` at `/opt/homebrew/bin/codex`,
`claude` CLI present, `gemini` CLI absent.

## Codex CLI facts the design relies on (verified from `codex exec --help`)

- Non-interactive: `codex [-a never] [-s read-only|workspace-write|danger-full-access] [-C <dir>] exec --json --color never [--ephemeral] [-o <file>] [-m <model>] "<prompt>"`
  (`-a`/`-s`/`-C` are top-level flags placed *before* `exec`, exactly as `cli_provider.rs:49-66` in the existing project does).
- `--json` prints JSONL events: `thread.started {thread_id}`, `turn.started`, `item.started|item.completed {item:{type: agent_message|command_execution|file_change|reasoning|mcp_tool_call|web_search, ...}}`, `turn.completed {usage}`, `error`.
- Multi-turn: `codex exec resume <thread_id> "<prompt>"` (so chats are *not* `--ephemeral`; one-shot subtasks are).
- `codex exec review` exists → usable for the "Fallback review" subtask kind.
- `--skip-git-repo-check` needed when the target dir is not a git repo.
- Reference implementation to mirror (do not import, it is project-coupled):
  `~/CubeCode/uygulanabilir-gorev-brifi-1-gorev-me/crates/cube-codex-runtime/src/{process_utils.rs,cli_provider.rs,event_parser.rs,redaction.rs}` — bounded stdout reader, timeout + graceful shutdown, JSONL normalization, secret redaction, "never surface raw reasoning text".

## Architecture

```
┌──────────────────────────── Tauri window (React 19 + TS) ────────────────────────────┐
│  app/ (shell, router)   features/* (screens)   design-system/*   engine/* (pure TS)    │
│  stores/* (Zustand)  ◄── engine EventBus ◄── workers: CodexWorker (real) | SimWorker   │
│                                              │ invoke()/Channel                       │
└──────────────────────────────────────────────┼───────────────────────────────────────┘
                                               ▼
┌──────────────────────────── src-tauri (Rust) ────────────────────────────────────────┐
│ commands: providers_detect, codex_run_start(Channel), codex_run_cancel, repo_inspect, │
│           fs_pick_dir, app_info                                                       │
│ crates/silent-runtime: process spawn (tokio), bounded reader, JSONL parser →          │
│           RuntimeEvent (serde, camelCase), redaction, timeouts                        │
│ plugins: tauri-plugin-sql (SQLite), tauri-plugin-store (settings JSON),               │
│          tauri-plugin-dialog (folder picker), tauri-plugin-shell (open external)      │
│ Phone Link hook: `bridge` module = trait + no-op impl (WS server is v2)               │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Key boundaries (each unit answers *what / how to use / depends on*):

1. **`src/engine/`** — pure TypeScript, zero React/Tauri imports, fully unit-tested.
   - `planner.ts`: prompt + repo hints → `Subtask[]` (kinds: architecture, backend, frontend, algorithm, tests, review, integration, docs). Heuristic keyword/intent rules + size estimate; deterministic given the same input.
   - `router.ts`: `(subtask, enabledModels, costMode, capabilityMatrix) → RoutingDecision {primary, fallbacks[], reason}`. Capability matrix is data (`engine/capabilities.ts`), cost mode is a weighting.
   - `executor.ts`: runs a `SilentCodeRun` as a dependency DAG; per-subtask retry (max N), fallback to next model, escalation (bump to higher tier on repeated failure); emits `RunEvent`s.
   - `workers/Worker.ts` interface: `start(job, sink) → handle`, `cancel()`. `CodexWorker` (calls Tauri), `SimulatedWorker` (scripted timeline for Claude/Gemini/Grok/GLM/Fable; realistic delays, logs, occasional scripted failure to demo retry/fallback).
   - `gateway.ts`: Gateway prompt → `GatewayProfile {role, behaviorProfile, guardrails[], contextPriority[], permissions, taskStyle, qualityExpectations[]}` via rule-based interpreter (phrase → trait). Optional later: ask Codex to refine it.
   - `events.ts`: typed `RunEvent` union (`run.started`, `subtask.state`, `worker.log`, `worker.file`, `worker.command`, `subtask.retry`, `subtask.fallback`, `run.completed`, `run.failed`).
2. **`src/services/`** — the only place that imports `@tauri-apps/api`. `codexService.ts` (invoke + Channel → async iterator of `RuntimeEvent`), `dbService.ts` (repositories over tauri-plugin-sql), `settingsService.ts`, `providerService.ts` (detect CLIs). Each has an in-memory fake for tests and for `npm run dev` in a plain browser (`VITE_SILENT_FAKE_BACKEND=1`).
3. **`src/stores/`** — Zustand slices: `chats`, `repoAgents`, `runs` (Silent Code sessions + live worker state), `memory`, `settings`, `ui` (right panel, drawers, active route context), `phoneLink`.
4. **`src/design-system/`** — tokens, primitives, composed "tactical" components (below).
5. **`src/features/<screen>/`** — one folder per screen: `dashboard`, `chat`, `repo-agents`, `silent-code`, `monitor`, `terminal-drawer`, `memory`, `settings`, `phone-link`, plus `new-session-modal`.
6. **`crates/silent-runtime`** — Rust lib, no Tauri dependency, `cargo test`able: `spawn.rs`, `codex/{args.rs, events.rs}`, `redaction.rs`, `error.rs`.
7. **`src-tauri/src/`** — thin command layer: `commands/{codex.rs, providers.rs, repo.rs}`, `db/migrations`, `lib.rs`.

## Data model (TS, `src/domain/*.ts`; mirrored by Rust serde structs where they cross IPC)

- `Provider { id: 'codex'|'claude'|'gemini'|'grok'|'glm'|'fable'; name; kind: 'cli'|'api'|'local'; cliBinary?; status: 'connected'|'not-installed'|'disabled'|'error'; version?; enabled }`
- `Model { id; providerId; displayName; tier: 'frontier'|'strong'|'fast'|'local'; strengths: SubtaskKind[]; costPer1kIn/Out; contextWindow; latencyClass }`
- `Chat { id; title; kind: 'standard'|'repo-agent'; modelId; repoAgentId?; gateway?; codexThreadId?; createdAt; updatedAt }`, `Message { id; chatId; role; content(markdown); blocks: (TaskCard|ExecutionSummary|CodeBlock)[]; usage?; createdAt }`
- `RepoAgent { id; name; repoPath; primaryModelId; fallbackModelIds[]; gatewayPrompt; gatewayProfile: GatewayProfile; permissions: AgentPermissions; toolsEnabled[]; memoryCount; status; lastActions: AgentAction[] }`
- `AgentPermissions { read; write; runTests; terminal; gitCommit; gitPush(false default); network; fileCreateDelete }` → maps to Codex sandbox: read-only if !write, workspace-write if write, never danger-full-access in v1.
- `SilentCodeRun { id; prompt; repoAgentId?; repoPath?; modelPool: modelId[]; executionMode: 'sequential'|'parallel'|'staged'; costMode; plan: Subtask[]; routing: RoutingDecision[]; status; startedAt; finishedAt; estimate: {tokens, costUsd, seconds} }`
- `Subtask { id; runId; kind; title; description; dependsOn[]; state: WorkerState; assignedModelId; attempts: Attempt[]; files: string[]; commands: string[]; summary?; }`
- `WorkerState = 'planning'|'thinking'|'coding'|'testing'|'reviewing'|'waiting'|'blocked'|'completed'|'failed'`
- `TerminalLine { ts; stream: 'stdout'|'stderr'|'system'; text }` kept in a ring buffer per subtask (cap 5k lines).
- `MemoryEntry { id; layer: 'user'|'repo'|'session'|'daily'; scopeId?; tags[]; title; body; source; createdAt; pinned }`
- `Settings { defaultPrimaryModelId; defaultFallbackModelId; costMode: 'economy'|'balanced'|'max-quality'|'local-first'|'zero-api'; routingOverrides: Partial<Record<SubtaskKind, modelId>>; theme; security: {allowDangerFullAccess:false, redactSecrets:true}; memory: {...}; repoIndex: {...} }`
- `PhoneLinkState { status: 'disconnected'|'pairing'|'connected'; pairingCode?; devices[]; lastSeen? }` (v1: UI + store + fake pairing flow, no server).
- `RuntimeEvent` (Rust → TS, `#[serde(tag="type", content="data", rename_all="camelCase")]`): `threadStarted{threadId}`, `turnStarted`, `textDelta{text}`, `agentMessage{text}`, `commandStarted{command}`, `commandCompleted{command, exitCode, outputTail}`, `fileChanged{path, kind}`, `reasoningStatus{status}` (summary only, never raw reasoning), `usage{...}`, `stderr{line}`, `turnCompleted`, `failed{code, message, retryable}`, `exited{code}`.

## SQLite schema (migrations via tauri-plugin-sql)

`providers`, `chats`, `messages`, `repo_agents`, `runs`, `subtasks`, `attempts`, `terminal_lines` (only last N per subtask persisted), `memory_entries`, `activity` (Recent Activity feed). Settings live in `settings.json` via tauri-plugin-store. No secrets stored in v1 (Codex uses its own login); a `SecureStore` interface exists with a `NotConfigured` impl so v2 can plug `keyring`.

## Design system ("Obsidian" theme)

- **Tokens** (`design-system/tokens.css`, Tailwind v4 `@theme`): bg `#050607/#0A0C0F/#111418/#171B21`, line `#1E242C`, text `#E6EAF0/#9AA4B2/#5C6675`, accent cyan `#39D2FF`, blue `#3B82F6`, violet `#8B5CF6`, success `#22D3A0`, warn `#F5B342`, danger `#FF4D5E`. Glow = `0 0 0 1px accent/30, 0 0 24px accent/20`. Radii 6/10/14. Glass = `bg/60 + backdrop-blur-md + 1px line`.
- **Fonts**: self-hosted via `@fontsource-variable/inter` + `@fontsource-variable/jetbrains-mono` (offline desktop, no CDN).
- **Primitives** (shadcn, added via `npx shadcn@latest add`): button, badge, card, dialog, drawer/sheet, dropdown-menu, tabs, tooltip, switch, checkbox, input, textarea, select, scroll-area, separator, progress, command (⌘K palette), popover, skeleton.
- **Tactical components** (`design-system/tactical/`): `GlowCard`, `TacticalChip`, `StatusBadge` (state → color/pulse), `ModelLogo` (SVG monograms per provider, crisp at any DPI, in `assets/logos/*.svg` — original placeholder marks, not trademarked logos), `ModelSelectorGrid`, `RouteGraph` (SVG DAG: Task → Model edges, animated flow), `ExecutionTimeline`, `TerminalView` (virtualized log lines, ANSI-stripped, mono), `MemoryTag`, `PermissionToggle`, `NeonButton`, `ProgressBar` (shimmer when active), `ActivityFeed`, `RepoCard`, `AgentWorkerCard`, `CostMeter`, `SectionHeader`, `KeyValueList`.
- **Motion**: `motion` (framer-motion v12) for panel transitions/hover glow; CSS keyframes for pulse/shimmer; respects `prefers-reduced-motion`.
- **Layout**: `AppShell` = 3-column CSS grid (sidebar 264px | main | right panel 360px collapsible), top bar 48px. Scales to 4K by fluid type (`clamp`) and max content width 1920 centered for reading surfaces; grids use `auto-fill, minmax()`.
- **Icons**: `lucide-react` only, 1.5px stroke.

## Screens (routes via react-router 7, `src/app/routes.tsx`)

| Route | Screen | Composition |
|---|---|---|
| `/` | Dashboard | KPI strip (active AIs, runs today, cost, providers online), Recent runs, Repo agents grid, provider health, quick launch (New Chat / Repo Agent / Silent Code) |
| `/chat/:id` | Standard Chat | message list (markdown via `react-markdown` + `rehype-highlight`, copy buttons, TaskCard/ExecutionSummary blocks, repo/context chips), composer with model chip + gateway indicator; right panel: context, tokens, thread id |
| modal | New Session | stepper: type (Chat / Repo Agent) → model → repo (folder picker) → Gateway prompt with live `GatewayProfile` preview |
| `/agents/:id` | Repo Agent Detail | header (name, status, primary/fallbacks), Gateway summary card, permissions matrix (git push off), tools, memory count, recent actions, "Open chat" / "Launch Silent Code here" |
| `/silent-code` | Silent Code | large prompt, ModelSelectorGrid with checkboxes, execution mode, cost mode, repo/agent picker, **Orchestration Preview** (plan + RouteGraph + estimate, recomputed live as pool/mode change), Start |
| `/runs/:id` | Live Monitor | overall progress, timeline, AgentWorkerCards grid (state, task, last update, badge), ActivityFeed; click card → Terminal Drawer |
| drawer | Terminal Detail | tabs: Commands given, Terminal output (live), Files touched, Summary, Logs, Retry history, Fallback actions; Cancel/Retry actions |
| `/memory` | Memory & Context | 4 layer tabs + filters (tag, scope, pinned), MemoryTag cards, add/edit/pin |
| `/settings` | Settings | sections: Connectors (Codex card first, doctor status, version, path), CLI integrations, Providers, Routing defaults, Cost mode, Theme, Security, Permissions defaults, Memory, Repo index, Logs |
| `/phone` | Phone Link | status, QR pairing card (fake code, expires), remote prompt concept, remote session monitor list, notifications toggle |

Sidebar: logo + "Silent", New (⌘N), Search (⌘K → command palette), sections Standard Chats / Repo Agents / Silent Code Sessions / Recent Activity, collapsible. Top bar: workspace title, model status dots, active-AI count, system status, cost mode chip, phone status, settings.

## Real Codex integration (v1 scope)

1. `providers_detect` runs `codex --version` (and `claude --version`, `gemini --version`) with 3s timeout → provider cards show real status. Never runs a model.
2. Standard Chat with Codex model → `codex -a never -s <sandbox> [-C repo] exec --json --color never [--skip-git-repo-check] "<prompt>"`; first turn stores `thread_id`, later turns use `exec resume <thread_id>`. Stream `textDelta`/`agentMessage` into the message; commands/files become TaskCards.
3. Silent Code subtask routed to Codex → `--ephemeral` one-shot with a subtask brief (role from Gateway profile + subtask description + repo path), sandbox from agent permissions; `kind: review` uses `codex exec review`. Output lines stream to the Terminal Drawer; `file_change` items populate Files touched; usage → cost meter.
4. Cancel → Rust kills the child (SIGTERM, then SIGKILL after grace).
5. Safety defaults: sandbox never above `workspace-write`; `-a never` always; stderr/stdout redacted for `sk-`, `ghp_`, bearer tokens (mirror `redaction.rs`); reasoning deltas dropped.
6. Simulated workers for other providers produce the same `RunEvent`s so every screen works identically regardless of which provider is real. Settings shows non-Codex CLIs as "not installed / simulated" honestly.

## File tree (top level)

```
~/CubeCode/silent/
  package.json  vite.config.ts  tsconfig.json  eslint.config.js  vitest.config.ts  components.json
  index.html    src/
    main.tsx  app/{App.tsx, routes.tsx, AppShell.tsx, providers.tsx}
    design-system/{tokens.css, ui/(shadcn), tactical/*, index.ts}
    domain/*.ts        engine/{planner,router,executor,gateway,capabilities,events}.ts  engine/workers/*
    services/*.ts      stores/*.ts      features/<screen>/*      mocks/{models,chats,agents,runs,memory}.ts
    lib/{cn.ts, format.ts, ids.ts}   assets/logos/*.svg   test/setup.ts
  crates/silent-runtime/{Cargo.toml, src/{lib.rs, spawn.rs, codex/{args.rs,events.rs}, redaction.rs, error.rs}}
  src-tauri/{Cargo.toml, tauri.conf.json, capabilities/default.json, migrations/0001_init.sql,
             src/{main.rs, lib.rs, commands/{codex.rs,providers.rs,repo.rs}, bridge.rs}}
  docs/superpowers/specs/2026-09-23-silent-design.md   README.md
```

## Implementation milestones (each leaves the app runnable)

1. **Scaffold** — `npm create tauri-app` equivalent by hand (Vite + React + TS), Tailwind v4 (`@tailwindcss/vite`, `@import "tailwindcss"`), `npx shadcn@latest init`, alias `@`, ESLint/Vitest, Cargo workspace with `crates/silent-runtime`, tauri plugins, git init. Copy this plan into `docs/superpowers/specs/…` as the design spec.
2. **Domain + mocks + engine (TDD)** — types, capability matrix, planner/router/gateway/executor with vitest specs (routing by cost mode, fallback on failure, escalation, DAG ordering, gateway phrase mapping, git push default off).
3. **Design system** — tokens, fonts, shadcn primitives, tactical components with a `/dev/kit` route (dev-only gallery) to eyeball them.
4. **App shell + routing + stores** — sidebar, top bar, right panel, command palette, persisted UI state; fake backend mode so `npm run dev` works in a browser.
5. **Screens** — Dashboard → Silent Code + Live Monitor + Terminal Drawer (flagship path first, driven by SimulatedWorkers) → Chat + New Session modal → Repo Agent detail → Memory → Settings → Phone Link.
6. **Rust runtime** — `silent-runtime` spawn + JSONL parser with unit tests (fixture JSONL lines), Tauri commands with Channel streaming, `providers_detect`, folder picker, SQLite migrations + repositories.
7. **Wire Codex for real** — `CodexWorker` + chat path; end-to-end run against a scratch repo; cancel; usage/cost display.
8. **Polish + verification** — 4K layout pass, reduced-motion, empty/error states, README, release check.

## Verification

- `npm run typecheck && npm run lint && npm run test` (engine specs, store specs, component smoke tests with Testing Library).
- `cargo test -p silent-runtime` (arg builder, JSONL → RuntimeEvent, redaction, bounded reader).
- `npm run tauri:dev`: manual checklist — providers card shows real Codex version; Silent Code run with mixed pool shows routing, live states, retry/fallback in monitor; open drawer streams real Codex output for a Codex-routed subtask against a scratch git repo in `/private/tmp/...`; cancel kills the process (`ps` shows no orphan); chat resumes the same thread across turns; settings persist across restart; all 10 routes render at 1440p and 4K without overflow.
- Playwright smoke (browser, fake backend): boot, navigate all routes, start a simulated run, open drawer.

## Out of scope for v1 (explicitly)

Real execution for non-Codex providers, phone WS server/APK, repo indexing/embeddings, API-key storage, auto-updater, code signing. Architecture hooks (Worker interface, `bridge.rs` trait, `SecureStore` interface, `repoIndex` settings) are present so these slot in without restructuring.
