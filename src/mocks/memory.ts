import type { MemoryEntry } from "@/domain"

const H = 3600_000
const now = Date.now()

export const MOCK_MEMORY: MemoryEntry[] = [
  { id: "mem_u1", layer: "user", tags: ["preference", "routing"], title: "Prefers Codex for frontend, Opus for review", body: "User repeatedly overrode routing to Codex on frontend subtasks and kept Opus as final reviewer.", source: "routing overrides · 6 runs", pinned: true, createdAt: now - 200 * H },
  { id: "mem_u2", layer: "user", tags: ["workflow"], title: "Wants tests run before 'done'", body: "Every Gateway prompt so far includes 'check tests before claiming completion'. Apply by default.", source: "gateway prompts", pinned: false, createdAt: now - 150 * H },
  { id: "mem_u3", layer: "user", tags: ["cost"], title: "Balanced cost mode, no paid upgrades", body: "Uses Balanced by default; switches to Economy for docs-only runs.", source: "settings history", pinned: false, createdAt: now - 90 * H },
  { id: "mem_r1", layer: "repo", scopeId: "agent_reach", scopeLabel: "Reach", tags: ["architecture"], title: "Drizzle ORM, not Prisma", body: "Data layer is Drizzle with SQLite in dev and Postgres in prod. Migrations live in /migrations and are generated, never hand-edited.", source: "run_notify · architecture worker", pinned: true, createdAt: now - 52 * H },
  { id: "mem_r2", layer: "repo", scopeId: "agent_reach", scopeLabel: "Reach", tags: ["rule", "style"], title: "Route handlers must validate with zod", body: "Every handler in src/server/routes uses a zod schema; the review worker rejects diffs without one.", source: "review worker", pinned: false, createdAt: now - 48 * H },
  { id: "mem_r3", layer: "repo", scopeId: "agent_reach", scopeLabel: "Reach", tags: ["bug"], title: "Reconnect storm on ws close", body: "Clients reconnect without backoff; fixed with jittered exponential backoff in hub.ts. Keep the test.", source: "chat_3", pinned: false, createdAt: now - 4 * H },
  { id: "mem_r4", layer: "repo", scopeId: "agent_cube_risk", scopeLabel: "Cube Risk Engine", tags: ["architecture", "decision"], title: "Simulation runs in a Web Worker (TS), not Rust", body: "Decision: keep the engine in TypeScript inside a Worker; Rust port rejected for build complexity.", source: "docs/decisions", pinned: true, createdAt: now - 400 * H },
  { id: "mem_r5", layer: "repo", scopeId: "agent_cube_risk", scopeLabel: "Cube Risk Engine", tags: ["performance"], title: "Diffusion step is the hot path", body: "1e6 cells at 60 fps target; typed arrays only, no object allocation in the loop.", source: "bench", pinned: false, createdAt: now - 8 * H },
  { id: "mem_s1", layer: "session", scopeId: "run_notify", scopeLabel: "Run · notifications", tags: ["routing"], title: "Gemini test worker failed once on socket timeout", body: "Retry on Gemini succeeded; no fallback needed. Consider a longer timeout for e2e subtasks.", source: "executor", pinned: false, createdAt: now - 2 * H },
  { id: "mem_s2", layer: "session", scopeId: "run_notify", scopeLabel: "Run · notifications", tags: ["output"], title: "Architecture brief accepted by all workers", body: "Opus brief split work into hub / routes / client; no contract changes were requested downstream.", source: "executor", pinned: false, createdAt: now - 2.5 * H },
  { id: "mem_d1", layer: "daily", scopeId: "phone_pixel", scopeLabel: "Pixel 9", tags: ["note"], title: "Ship notification feature before Friday demo", body: "Sent from phone at 08:12. Priority: high.", source: "Phone Link", pinned: true, createdAt: now - 11 * H },
  { id: "mem_d2", layer: "daily", scopeId: "phone_pixel", scopeLabel: "Pixel 9", tags: ["reminder"], title: "Check Cube Risk bench numbers after lunch", body: "Reminder from phone.", source: "Phone Link", pinned: false, createdAt: now - 6 * H },
]
