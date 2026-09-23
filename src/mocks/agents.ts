import type { RepoAgent } from "@/domain"
import { DEFAULT_PERMISSIONS } from "@/domain"
import { interpretGateway } from "@/engine/gateway"

const H = 3600_000
const now = Date.now()

function agent(partial: Omit<RepoAgent, "gatewayProfile" | "createdAt" | "updatedAt" | "lastActions"> & { lastActions?: RepoAgent["lastActions"] }): RepoAgent {
  return {
    ...partial,
    gatewayProfile: interpretGateway(partial.gatewayPrompt),
    lastActions: partial.lastActions ?? [],
    createdAt: now - 30 * 24 * H,
    updatedAt: now - 2 * H,
  }
}

export const MOCK_AGENTS: RepoAgent[] = [
  agent({
    id: "agent_reach",
    name: "Reach Backend",
    repoPath: "/Users/cube/CubeCode/reach",
    primaryModelId: "codex",
    fallbackModelIds: ["claude-sonnet", "claude-opus"],
    gatewayPrompt:
      "Act like a senior backend engineer for this repo. Respect current architecture. Check tests before claiming completion. Avoid unnecessary dependencies. Focus on stability and clean code.",
    permissions: { ...DEFAULT_PERMISSIONS, gitCommit: true },
    toolsEnabled: ["shell", "git", "tests", "file-edit", "search"],
    memoryCount: 38,
    status: "idle",
    lastActions: [
      { id: "a1", at: now - 2 * H, kind: "run", title: "Silent Code: real-time notification system", detail: "6 subtasks · 3 models · completed", ok: true },
      { id: "a2", at: now - 5 * H, kind: "test", title: "vitest run — 128 passed", ok: true },
      { id: "a3", at: now - 26 * H, kind: "commit", title: "feat(notifications): websocket fan-out", detail: "7 files", ok: true },
      { id: "a4", at: now - 30 * H, kind: "edit", title: "src/server/notify/service.ts", ok: true },
      { id: "a5", at: now - 52 * H, kind: "memory", title: "Learned: repo uses Drizzle, not Prisma", ok: true },
    ],
  }),
  agent({
    id: "agent_cube_risk",
    name: "Cube Risk Engine",
    repoPath: "/Users/cube/CubeCode/cube-risk-world-simulation-engine",
    primaryModelId: "claude-opus",
    fallbackModelIds: ["fable-ultracode", "codex"],
    gatewayPrompt:
      "You are the algorithms engineer for a world simulation engine. Performance matters. Never delete files. Explain your decisions. Do not commit.",
    permissions: { ...DEFAULT_PERMISSIONS, fileCreateDelete: false, gitCommit: false },
    toolsEnabled: ["shell", "tests", "file-edit", "search"],
    memoryCount: 121,
    status: "working",
    lastActions: [
      { id: "b1", at: now - 0.3 * H, kind: "run", title: "Silent Code: vectorise diffusion step", detail: "running · 4/7", ok: true },
      { id: "b2", at: now - 8 * H, kind: "test", title: "bench: diffusion 1e6 cells 38ms → 21ms", ok: true },
      { id: "b3", at: now - 20 * H, kind: "run", title: "Silent Code: fix NaN in pressure solver", detail: "failed on Gemini, recovered on Opus", ok: false },
    ],
  }),
  agent({
    id: "agent_terminal",
    name: "Market Terminal",
    repoPath: "/Users/cube/CubeCode/uygulanabilir-gorev-brifi-1-gorev-me",
    primaryModelId: "codex",
    fallbackModelIds: ["claude-sonnet"],
    gatewayPrompt: "Senior frontend engineer. Strict TypeScript, no any. Read-only until asked. Security matters — never log secrets.",
    permissions: { ...DEFAULT_PERMISSIONS, write: false, fileCreateDelete: false, network: false },
    toolsEnabled: ["search", "tests"],
    memoryCount: 12,
    status: "idle",
    lastActions: [{ id: "c1", at: now - 70 * H, kind: "chat", title: "Reviewed order-book rendering perf", ok: true }],
  }),
]
