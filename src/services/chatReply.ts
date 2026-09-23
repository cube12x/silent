import type { Chat, MessageBlock } from "@/domain"
import { MODEL_BY_ID } from "@/engine/capabilities"

/**
 * Simulated assistant reply for providers Silent cannot execute yet. Streams markdown word by word
 * through the same callbacks the real Codex path uses, so the chat UI is provider-agnostic.
 */
export function simulateReply(chat: Chat, prompt: string, onDelta: (text: string) => void, signal: { cancelled: boolean }): Promise<{ text: string; blocks: MessageBlock[] }> {
  const model = MODEL_BY_ID[chat.modelId]
  const name = model?.displayName ?? chat.modelId
  const repo = chat.repoPath ? chat.repoPath.split("/").filter(Boolean).pop() : undefined
  const text = [
    `**${name}** (simulated — this provider is not wired for real execution yet).`,
    "",
    repo ? `Working against \`${repo}\`${chat.gatewayProfile ? ` as *${chat.gatewayProfile.role}*` : ""}.` : "",
    "",
    `Here is how I would approach: _${prompt.length > 120 ? prompt.slice(0, 117) + "…" : prompt}_`,
    "",
    "1. Read the relevant modules and confirm the existing contract.",
    "2. Make the smallest safe change and keep the public interface stable.",
    "3. Add or update tests, then run the suite before reporting.",
    "",
    "```ts",
    "// example: guarded change with an explicit contract",
    "export function apply(input: Input): Result {",
    "  assertValid(input)",
    "  return transform(input)",
    "}",
    "```",
    "",
    "Switch this chat to **Codex** to execute for real through the Codex CLI.",
  ].join("\n")
  const blocks: MessageBlock[] = repo ? [{ type: "context", label: "Context", items: [repo, ...(chat.gatewayProfile?.contextPriority.slice(0, 2) ?? [])] }] : []
  return new Promise((resolve) => {
    const words = text.split(/(\s+)/)
    let i = 0
    const tick = () => {
      if (signal.cancelled) return resolve({ text: words.slice(0, i).join(""), blocks })
      const chunk = words.slice(i, i + 3).join("")
      i += 3
      onDelta(chunk)
      if (i >= words.length) return resolve({ text, blocks })
      setTimeout(tick, 18)
    }
    tick()
  })
}
