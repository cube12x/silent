import type { Backend } from "@/services/backend"
import type { CliRunRequest, ProviderId, RuntimeEvent } from "@/domain"
import { parseModelRef } from "@/domain"

export interface SingleRunResult {
  ok: boolean
  text: string
  sessionId?: string
  error?: string
  tokens: number
}

/**
 * One CLI session with one model in one folder (Blueprint "single" mode, wizards, naming). No planner,
 * no workers: the model does the whole prompt itself. Resolves when the process exits.
 */
export function runSingle(
  backend: Pick<Backend, "cliStart">,
  opts: { runId: string; modelRef: string; prompt: string; cwd?: string; readOnly?: boolean; resumeSessionId?: string; timeoutSecs?: number; effort?: string },
  onLine?: (line: string, stream: "stdout" | "stderr" | "system") => void,
): { done: Promise<SingleRunResult>; cancel: () => Promise<void> } {
  const { providerId, modelId } = parseModelRef(opts.modelRef)
  const request: CliRunRequest = {
    runId: opts.runId,
    providerId: providerId as ProviderId,
    modelId: modelId || undefined,
    prompt: opts.prompt,
    cwd: opts.cwd,
    sandbox: opts.readOnly ? "read-only" : "workspace-write",
    network: !opts.readOnly,
    ephemeral: false,
    resumeSessionId: opts.resumeSessionId,
    timeoutSecs: opts.timeoutSecs ?? 40 * 60,
    effort: opts.effort as CliRunRequest["effort"],
  }
  let handle: { cancel(): Promise<void> } | undefined
  const messages: string[] = []
  let sessionId: string | undefined
  let error: string | undefined
  let tokens = 0
  let resolveDone!: (r: SingleRunResult) => void
  const done = new Promise<SingleRunResult>((r) => (resolveDone = r))
  const onEvent = (e: RuntimeEvent) => {
    switch (e.type) {
      case "sessionStarted":
        sessionId = e.data.sessionId
        onLine?.(`session ${e.data.sessionId}`, "system")
        break
      case "agentMessage":
        messages.push(e.data.text)
        onLine?.(e.data.text, "stdout")
        break
      case "commandStarted":
        onLine?.(`$ ${e.data.command}`, "stdout")
        break
      case "fileChanged":
        onLine?.(`${e.data.kind} ${e.data.path}`, "stdout")
        break
      case "stderr":
        onLine?.(e.data.line, "stderr")
        break
      case "usage":
        tokens += Math.max(0, e.data.inputTokens - (e.data.cachedInputTokens ?? 0)) + e.data.outputTokens
        break
      case "failed":
        error = e.data.message
        onLine?.(`error: ${e.data.message}`, "stderr")
        break
      case "exited":
        resolveDone({ ok: !error, text: messages.join("\n\n").trim(), sessionId, error, tokens })
        break
      default:
        break
    }
  }
  backend
    .cliStart(request, onEvent)
    .then((h) => {
      handle = h
    })
    .catch((err: unknown) => {
      resolveDone({ ok: false, text: "", error: err instanceof Error ? err.message : String(err), tokens })
    })
  return { done, cancel: async () => handle?.cancel() }
}
