import type { Chat, Message } from "@/domain"
import { interpretGateway } from "@/engine/gateway"

const H = 3600_000
const now = Date.now()

export const MOCK_CHATS: Chat[] = [
  { id: "chat_1", title: "Design the run scheduler", kind: "standard", modelId: "claude-opus", createdAt: now - 3 * H, updatedAt: now - 1 * H },
  { id: "chat_2", title: "Explain Tauri channels", kind: "standard", modelId: "codex", createdAt: now - 26 * H, updatedAt: now - 25 * H },
  {
    id: "chat_3",
    title: "Reach · notification fan-out",
    kind: "repo-agent",
    modelId: "codex",
    repoAgentId: "agent_reach",
    repoPath: "/Users/cube/CubeCode/reach",
    gatewayPrompt: "Act like a senior backend engineer for this repo. Check tests before claiming completion.",
    gatewayProfile: interpretGateway("Act like a senior backend engineer for this repo. Check tests before claiming completion."),
    createdAt: now - 50 * H,
    updatedAt: now - 4 * H,
  },
  { id: "chat_4", title: "Prompt for Gemini test-gen", kind: "standard", modelId: "gemini", createdAt: now - 100 * H, updatedAt: now - 99 * H },
]

export const MOCK_MESSAGES: Record<string, Message[]> = {
  chat_1: [
    { id: "m1", chatId: "chat_1", role: "user", content: "Design a run scheduler that executes a subtask DAG with per-model concurrency limits. Keep it deterministic for tests.", blocks: [], createdAt: now - 3 * H },
    {
      id: "m2",
      chatId: "chat_1",
      role: "assistant",
      modelId: "claude-opus",
      content: `Here is a scheduler shape that stays deterministic:

**Core loop**

1. Compute \`ready\` = tasks whose dependencies are all \`completed\`.
2. Fill up to \`limit\` slots in plan order (stable ordering is what makes tests deterministic).
3. \`await Promise.race(running)\` and loop.

\`\`\`ts
while (!done) {
  const ready = plan.filter(isReady)
  for (const t of ready) if (running.size < limit) running.set(t.id, execute(t))
  await Promise.race(running.values())
}
\`\`\`

Failure handling belongs *inside* \`execute\`: retry on the same model, then fall back through the routing decision's fallback list, then escalate one tier. The scheduler only sees terminal states.`,
      blocks: [{ type: "context", label: "Context", items: ["engine/executor.ts", "engine/router.ts"] }],
      usage: { inputTokens: 1420, outputTokens: 610, totalTokens: 2030 },
      createdAt: now - 3 * H + 60_000,
    },
  ],
  chat_3: [
    { id: "m5", chatId: "chat_3", role: "user", content: "Add a websocket fan-out for notifications and make sure the tests cover reconnect.", blocks: [], createdAt: now - 5 * H },
    {
      id: "m6",
      chatId: "chat_3",
      role: "assistant",
      modelId: "codex",
      content: "Implemented the fan-out as a `NotificationHub` with per-connection backpressure. Reconnect is covered by two new tests.",
      blocks: [
        { type: "task-card", title: "npm run typecheck", status: "done", command: "npm run typecheck" },
        { type: "task-card", title: "npx vitest run src/server/notify", status: "done", command: "npx vitest run src/server/notify", detail: "14 passed" },
        { type: "execution-summary", title: "Execution summary", filesTouched: ["src/server/notify/hub.ts", "src/server/notify/hub.test.ts", "src/server/routes/ws.ts"], commands: ["npm run typecheck", "npx vitest run src/server/notify"], durationMs: 214_000, tokens: 18_400 },
      ],
      usage: { inputTokens: 12_400, outputTokens: 6_000, totalTokens: 18_400 },
      createdAt: now - 4 * H,
    },
  ],
}
