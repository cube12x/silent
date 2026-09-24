/**
 * Expert kits: domain briefs + curated reference repositories that workers study before designing.
 * References are shallow-cloned into `<repo>/.silent/refs/<name>` (git-ignored) by the host app.
 */
export interface KitReference {
  name: string
  url: string
  /** What to look at in it. */
  hint: string
}

export interface ExpertKit {
  id: string
  name: { tr: string; en: string }
  /** Keywords (lower-case, TR+EN) used to auto-detect the kit from the request. */
  keywords: string[]
  /** English brief prepended to every worker's instructions. */
  brief: string
  /** English, checked by the polish reviewer at the end of the run. */
  checklist: string[]
  references: KitReference[]
}

export const BUILTIN_KITS: ExpertKit[] = [
  {
    id: "game-2d-web",
    name: { tr: "2D oyun (web, Canvas/WebGL)", en: "2D game (web, Canvas/WebGL)" },
    keywords: ["oyun", "game", "platformer", "canvas", "webgl", "sprite", "boss", "combat", "savaş", "phaser", "pixi", "arcade", "roguelike", "samuray"],
    brief: [
      "Expert kit: 2D web game. Ship a game that FEELS great, not a tech demo.",
      "Non-negotiables: fixed-timestep simulation decoupled from rendering (accumulator, interpolation); input buffering and coyote time; hit-stop, screen shake, squash & stretch, particles and sound on every impact ('juice'); readable telegraphs before enemy attacks; a real state machine per entity; a finite-state game flow (title → play → pause → game over) with a working restart; 60 fps on a mid laptop (object pools, no per-frame allocations in hot paths, batched draws).",
      "Content bar: hand-tuned constants exposed in one tuning file; at least one memorable set-piece (boss with phases or a climax); audio via Web Audio with a master gain; keyboard AND gamepad; responsive canvas with letterboxing; save/continue.",
      "Process: study the reference implementations in .silent/refs first (engine loop, input, scene/state machines, effects); reuse their proven patterns and structure instead of inventing new ones; keep your own code — copy only ideas and small MIT-licensed snippets with attribution in a comment.",
    ].join(" "),
    checklist: [
      "Fixed-timestep loop with interpolation; no visible stutter or tunneling",
      "Every hit has feedback: hit-stop, shake, particles, sound",
      "Enemy attacks are telegraphed and readable; difficulty ramps",
      "Title/play/pause/game over/restart all work; no dead ends",
      "Runs at 60 fps on a mid laptop (no per-frame allocations in hot paths)",
      "Keyboard and gamepad both work; canvas letterboxes on resize",
      "Audio present with master volume; no autoplay errors",
      "npm run build passes; the built game opens and plays in a real browser",
    ],
    references: [
      { name: "littlejs", url: "https://github.com/KilledByAPixel/LittleJS", hint: "Tiny, complete 2D engine: game loop, input, particles, sound, tile collision. Read engine/ and examples/." },
      { name: "kaplay", url: "https://github.com/kaplayjs/kaplay", hint: "Component-based 2D engine; scenes, sprites, physics helpers, examples/ has dozens of small complete games." },
      { name: "excalibur", url: "https://github.com/excaliburjs/Excalibur", hint: "TypeScript 2D engine: actors, scenes, fixed update, collision, camera. Study src/engine/ structure." },
    ],
  },
  {
    id: "web-app",
    name: { tr: "Web uygulaması (React / Next.js)", en: "Web app (React / Next.js)" },
    keywords: ["web app", "web uygulaması", "next", "react", "dashboard", "saas", "landing", "site", "frontend", "tailwind", "auth", "login"],
    brief: [
      "Expert kit: production web app. Non-negotiables: typed end to end; routing, data fetching, forms with validation and error states; accessible components (keyboard, focus, aria); loading/empty/error states for every view; responsive from 360px to 1440px; no layout shift; auth and authorization boundaries explicit; environment config validated at startup.",
      "Quality bar: looks designed (consistent spacing scale, typography, color tokens), not a wireframe. Lighthouse-level performance: code splitting, images optimized, no blocking scripts.",
      "Process: study .silent/refs for project structure, component patterns and data flow before designing; reuse proven patterns.",
    ].join(" "),
    checklist: [
      "Typecheck, lint and tests pass; build succeeds",
      "Every view has loading, empty and error states",
      "Keyboard navigation and focus rings work; no aria violations in the main flows",
      "Responsive at 360px and 1440px without horizontal scroll",
      "Forms validate and show errors inline",
      "Consistent design tokens; no default-browser look",
    ],
    references: [
      { name: "taxonomy", url: "https://github.com/shadcn-ui/taxonomy", hint: "Next.js app with auth, dashboard, billing patterns and shadcn/ui usage." },
      { name: "epic-stack", url: "https://github.com/epicweb-dev/epic-stack", hint: "Opinionated full-stack app: auth, forms, testing, error boundaries, progressive enhancement." },
      { name: "create-t3-app", url: "https://github.com/t3-oss/create-t3-app", hint: "Typed end-to-end structure: tRPC, Prisma/Drizzle, env validation." },
    ],
  },
  {
    id: "backend-api",
    name: { tr: "Backend / API servisi", en: "Backend / API service" },
    keywords: ["api", "backend", "servis", "service", "rest", "graphql", "microservice", "endpoint", "database", "veritabanı", "postgres", "redis", "queue", "kuyruk"],
    brief: [
      "Expert kit: production backend. Non-negotiables: layered structure (transport → service → repository), input validation at the boundary, typed errors mapped to HTTP codes, structured logging with request ids, graceful shutdown, health/readiness endpoints, config from env validated at startup, idempotent writes where retried, migrations under version control, integration tests against a real database (containers or in-memory where the engine allows).",
      "Process: study .silent/refs for folder structure, error handling and testing patterns before designing.",
    ].join(" "),
    checklist: [
      "Typecheck/lint/tests pass; integration tests cover the main flows",
      "Every endpoint validates input and returns typed errors",
      "Structured logs with request ids; health and readiness endpoints",
      "Graceful shutdown; no unhandled promise rejections",
      "Migrations versioned; schema matches the models",
    ],
    references: [
      { name: "hono", url: "https://github.com/honojs/hono", hint: "Small typed web framework; middleware, validation and testing patterns in src/ and examples." },
      { name: "fastify", url: "https://github.com/fastify/fastify", hint: "Plugin architecture, schema validation, hooks, lifecycle and testing conventions." },
      { name: "nodebestpractices", url: "https://github.com/goldbergyoni/nodebestpractices", hint: "Checklist of production Node.js practices (structure, errors, security, testing)." },
    ],
  },
  {
    id: "desktop-tauri",
    name: { tr: "Masaüstü uygulaması (Tauri / Rust)", en: "Desktop app (Tauri / Rust)" },
    keywords: ["tauri", "masaüstü", "desktop", "rust", "electron", "native", "menubar", "tray"],
    brief: [
      "Expert kit: Tauri 2 desktop app. Non-negotiables: capabilities/permissions minimal and explicit; commands typed on both sides with a shared contract; long work streamed via Channels, never blocking the UI; window state persisted; native dialogs (no browser prompt/confirm); app icon and bundle metadata set; release build tested.",
      "Process: study .silent/refs for command/plugin patterns before designing.",
    ].join(" "),
    checklist: ["cargo clippy and tests pass; frontend typecheck/lint/tests pass", "Release bundle builds and launches", "No browser prompt/alert/confirm in the webview", "Capabilities list only what is used"],
    references: [
      { name: "tauri-plugins", url: "https://github.com/tauri-apps/plugins-workspace", hint: "Official plugins: command patterns, permissions, JS bindings." },
      { name: "create-tauri-app", url: "https://github.com/tauri-apps/create-tauri-app", hint: "Reference project layouts per frontend framework." },
    ],
  },
  {
    id: "ml-python",
    name: { tr: "Veri / model eğitimi (Python)", en: "Data / model training (Python)" },
    keywords: ["model eğit", "training", "pytorch", "tensorflow", "dataset", "veri seti", "ml", "machine learning", "llm", "fine-tune", "embedding", "sklearn", "pandas"],
    brief: [
      "Expert kit: reproducible ML. Non-negotiables: uv/venv with pinned deps; config-driven experiments (one YAML/TOML per run); deterministic seeds; train/val/test split documented; metrics logged per epoch to a file; checkpoints and resume; evaluation script separate from training; a small smoke dataset so the pipeline runs in under a minute; README with exact commands and expected numbers.",
      "Process: study .silent/refs for training-loop and project structure before designing.",
    ].join(" "),
    checklist: ["Smoke run completes end to end in under a minute", "Metrics and checkpoints written; resume works", "Seeds fixed; results reproducible", "README commands verified"],
    references: [
      { name: "nanogpt", url: "https://github.com/karpathy/nanoGPT", hint: "Minimal, readable training loop, config system, checkpoints, evaluation." },
      { name: "pytorch-examples", url: "https://github.com/pytorch/examples", hint: "Canonical task examples with data loading, training and evaluation structure." },
    ],
  },
]

export function kitById(id: string | undefined): ExpertKit | undefined {
  return id ? BUILTIN_KITS.find((k) => k.id === id) : undefined
}

/** Best kit for a request by keyword hits (undefined when nothing matches). */
export function detectKit(prompt: string): ExpertKit | undefined {
  const text = prompt.toLowerCase()
  let best: { kit: ExpertKit; hits: number } | undefined
  for (const kit of BUILTIN_KITS) {
    const hits = kit.keywords.filter((k) => text.includes(k)).length
    if (hits && (!best || hits > best.hits)) best = { kit, hits }
  }
  return best?.kit
}

/** English brief text for workers and the planner: kit brief + checklist + where the references live. */
export function renderKitBrief(kit: ExpertKit, refPaths: Array<{ name: string; path: string; hint: string }> = []): string {
  const refs = refPaths.length
    ? `Reference implementations (read-only, study before designing):\n${refPaths.map((r) => `- ${r.path} — ${r.hint}`).join("\n")}`
    : `Reference implementations: ${kit.references.map((r) => `${r.url} (${r.hint})`).join("; ")}`
  return [`EXPERT KIT — ${kit.name.en}`, kit.brief, `Quality checklist (the final polish review scores against this):\n${kit.checklist.map((c) => `- ${c}`).join("\n")}`, refs].join("\n\n")
}
